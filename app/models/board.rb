# frozen_string_literal: true

class Board < ApplicationRecord
  ROLES = %w[viewer editor manager owner].freeze
  EMPTY_CANVAS = '{"version":"5.3.0","objects":[],"background":"#ffffff"}'

  has_many :board_pages, -> { order(:position) }, dependent: :destroy
  has_many :board_permissions, dependent: :destroy

  validates :title, :owner_nickname, presence: true
  after_create :create_first_page

  def role_for(nickname)
    user = nickname.to_s.strip
    return "viewer" if user.blank?
    return "owner" if owner_nickname.casecmp?(user)

    custom = board_permissions.find { |p| p.nickname.casecmp?(user) }
    custom&.role || access_level.presence || "manager"
  end

  def capabilities_for(nickname)
    role = role_for(nickname)
    {
      role: role,
      can_edit: %w[editor manager owner].include?(role),
      can_manage_pages: %w[manager owner].include?(role),
      can_manage_permissions: role == "owner"
    }
  end

  private

  def create_first_page
    board_pages.create!(position: 1, canvas_data: EMPTY_CANVAS) if board_pages.empty?
  end
end
