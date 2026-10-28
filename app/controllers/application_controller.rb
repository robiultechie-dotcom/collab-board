# frozen_string_literal: true
class ApplicationController < ActionController::Base
  helper_method :current_nickname
  def current_nickname
    session[:board_user].presence
  end
end
