# frozen_string_literal: true

class BoardChannel < ActionCable::Channel::Base
  def subscribed
    @board = Board.find_by(id: params[:board_id])
    return reject unless @board

    @nickname = params[:nickname].to_s.strip.presence || "Guest"
    stream_from "board_#{@board.id}"
  end

  def draw_delta(data)
    return unless @board && @board.capabilities_for(@nickname)[:can_edit]

    ActionCable.server.broadcast("board_#{@board.id}", {
      type: "delta_event",
      sender_id: data["client_id"].to_s,
      page_id: data["page_id"].to_i,
      action_type: data["action_type"],
      object_json: data["object_json"],
      object_uid: data["object_uid"]
    })
  end

  def cursor_move(data)
    return unless @board

    ActionCable.server.broadcast("board_#{@board.id}", {
      type: "cursor_moved",
      sender_id: data["client_id"].to_s,
      nickname: @nickname,
      page_id: data["page_id"].to_i,
      x: data["x"],
      y: data["y"]
    })
  end
end
