# frozen_string_literal: true

class BoardPage < ApplicationRecord
  belongs_to :board
  validates :position, presence: true
end
