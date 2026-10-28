# frozen_string_literal: true

class BoardsController < ApplicationController
  MAX_CANVAS = 5.megabytes
  MAX_THUMB  = 300.kilobytes

  skip_before_action :verify_authenticity_token, only: %i[save_page add_page remove_page update_permissions]
  before_action :require_nickname, only: %i[show create]
  before_action :set_board, only: %i[show state destroy add_page save_page remove_page update_permissions]

  def index
    session[:return_to] = params[:return_to] if params[:return_to].present?
    return if current_nickname.blank?
    @boards = Board.includes(:board_permissions).order(updated_at: :desc)
    @page_counts = BoardPage.group(:board_id).count
  end

  def set_nickname
    nick = params[:nickname].to_s.strip[0, 30]
    session[:board_user] = nick if nick.present?
    redirect_to(session.delete(:return_to).presence || root_path)
  end

  def clear_nickname
    session.delete(:board_user)
    redirect_to root_path
  end

  def show
    @pages = @board.board_pages.order(:position).to_a
    @capabilities = @board.capabilities_for(current_nickname)
    @permissions = @board.board_permissions.order(:nickname)
  end

  def state
    page = @board.board_pages.find_by(id: params[:page_id]) || @board.board_pages.order(:position).first
    version = page&.updated_at.to_f
    since = params[:since].to_f
    if page && since > 0 && version <= since + 0.0001
      return render json: { page_id: page.id, version: version, unchanged: true }
    end
    render json: { page_id: page&.id, version: version, canvas_data: page&.canvas_data }
  end

  def create
    title = params[:title].to_s.strip.presence || "Untitled Board ##{Board.count + 1}"
    board = Board.create!(title: title, owner_nickname: current_nickname, access_level: "manager")
    redirect_to board_path(board)
  end

  def destroy
    @board.destroy if @board.role_for(current_nickname) == "owner"
    redirect_to root_path
  end

  def save_page
    actor = current_nickname.presence || params[:nickname].to_s.strip
    return head :forbidden unless @board.capabilities_for(actor)[:can_edit]
    page = @board.board_pages.find_by(id: params[:page_id]) || @board.board_pages.order(:position).first
    return head :not_found unless page

    raw = params[:canvas_data]
    canvas_json = raw.is_a?(String) ? raw : (raw.present? ? raw.to_json : nil)
    canvas_json = nil if canvas_json == "null"
    return head :payload_too_large if canvas_json.to_s.bytesize > MAX_CANVAS

    thumb = params[:thumbnail].to_s
    thumb = nil unless thumb.start_with?("data:image/jpeg;base64,") && thumb.bytesize <= MAX_THUMB

    updates = { updated_at: Time.current }
    updates[:canvas_data] = canvas_json if canvas_json.present?
    updates[:thumbnail] = thumb if thumb
    page.update_columns(updates)

    board_updates = { updated_at: Time.current }
    board_updates[:thumbnail] = thumb if thumb && page.position == 1
    @board.update_columns(board_updates)

    version = page.updated_at.to_f
    if canvas_json.present?
      ActionCable.server.broadcast("board_#{@board.id}", {
        type: "canvas_updated",
        sender_id: params[:client_id].to_s,
        page_id: page.id,
        version: version,
        canvas_data: canvas_json
      })
    end
    render json: { saved: true, page_id: page.id, version: version }
  end

  def add_page
    actor = current_nickname.presence || params[:nickname].to_s.strip
    return head :forbidden unless @board.capabilities_for(actor)[:can_manage_pages]
    next_pos = (@board.board_pages.maximum(:position) || 0) + 1
    page = @board.board_pages.create!(position: next_pos, canvas_data: Board::EMPTY_CANVAS)
    broadcast_pages
    render json: { page: serialize_page(page) }
  end

  def remove_page
    actor = current_nickname.presence || params[:nickname].to_s.strip
    return head :forbidden unless @board.capabilities_for(actor)[:can_manage_pages]
    return head :unprocessable_entity if @board.board_pages.count <= 1
    @board.board_pages.find(params[:page_id]).destroy!
    @board.board_pages.order(:position).each_with_index { |p, i| p.update_column(:position, i + 1) }
    @board.update_column(:thumbnail, @board.board_pages.order(:position).first&.thumbnail)
    broadcast_pages
    render json: { ok: true }
  end

  def update_permissions
    actor = current_nickname.presence || params[:nickname].to_s.strip
    return head :forbidden unless @board.capabilities_for(actor)[:can_manage_permissions]
    if params[:access_level].present? && Board::ROLES.include?(params[:access_level])
      @board.update!(access_level: params[:access_level])
    end
    if params[:target_nickname].present?
      perm = @board.board_permissions.find_or_initialize_by(nickname: params[:target_nickname].to_s.strip)
      params[:role] == "remove" ? perm.destroy : perm.update!(role: params[:role].to_s)
    end
    payload = {
      type: "permissions_updated",
      access_level: @board.access_level,
      permissions: @board.board_permissions.order(:nickname).map { |p| { nickname: p.nickname, role: p.role } }
    }
    ActionCable.server.broadcast("board_#{@board.id}", payload)
    render json: payload
  end

  private

  def require_nickname
    nick = session[:board_user].to_s.strip
    if nick.empty? || nick.casecmp("guest").zero?
      session.delete(:board_user)
      session[:return_to] = request.fullpath if request.get?
      redirect_to root_path, alert: "Please enter your nickname to open this board."
      return false
    end
  end

  def set_board
    @board = Board.find(params[:id])
  end

  def serialize_page(page)
    { id: page.id, position: page.position, canvas_data: page.canvas_data, thumbnail: page.thumbnail, version: page.updated_at.to_f }
  end

  def broadcast_pages
    pages = @board.board_pages.reload.order(:position).map { |p| serialize_page(p) }
    ActionCable.server.broadcast("board_#{@board.id}", { type: "pages_updated", pages: pages })
  end
end
