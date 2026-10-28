# frozen_string_literal: true

class ApplicationController < ActionController::Base
  helper_method :current_nickname

  def current_nickname
    nick = session[:board_user].to_s.strip
    nick.presence
  end
end
