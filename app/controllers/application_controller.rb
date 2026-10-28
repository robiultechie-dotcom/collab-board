# frozen_string_literal: true
class ApplicationController < ActionController::Base
  helper_method :current_nickname
  def current_nickname
    nick = session[:board_user].to_s.strip
    return nil if nick.empty? || nick.casecmp("guest").zero?
    nick
  end
end
