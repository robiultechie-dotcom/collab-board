# frozen_string_literal: true

class BoardPermission < ApplicationRecord
  belongs_to :board
  validates :nickname, presence: true
  validates :role, inclusion: { in: Board::ROLES }
end
