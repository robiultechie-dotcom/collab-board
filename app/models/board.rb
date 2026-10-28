# frozen_string_literal: true
class Board < ApplicationRecord
  ROLES = %w[viewer editor manager].freeze
  EMPTY_CANVAS = '{"version":"5.3.0","objects":[],"background":"#ffffff"}'
  has_many :board_pages, -> { order(:position) }, dependent: :destroy
  has_many :board_permissions, dependent: :destroy
  validates :title, presence: true
  validates :owner_nickname, presence: true
  validates :access_level, inclusion: { in: ROLES }
  after_create :ensure_initial_page
  def role_for(nickname)
    nick = nickname.to_s.strip
    return "viewer" if nick.blank?
    return "owner" if nick.casecmp(owner_nickname.to_s.strip).zero?
    custom = board_permissions.find { |p| p.nickname.to_s.strip.casecmp(nick).zero? }
    custom ||= board_permissions.where("LOWER(nickname) = ?", nick.downcase).first
    custom ? custom.role : (access_level.presence || "manager")
  end
  def capabilities_for(nickname)
    r = role_for(nickname)
    {
      role: r,
      can_edit: %w[editor manager owner].include?(r),
      can_manage_pages: %w[manager owner].include?(r),
      can_manage_permissions: r == "owner"
    }
  end
  private
  def ensure_initial_page
    board_pages.create!(position: 1, canvas_data: EMPTY_CANVAS) if board_pages.empty?
  end
end
