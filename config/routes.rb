# frozen_string_literal: true
Rails.application.routes.draw do
  mount ActionCable.server => "/cable"
  root "boards#index"
  post "session/nickname", to: "boards#set_nickname", as: :set_nickname
  delete "session/nickname", to: "boards#clear_nickname", as: :clear_nickname
  resources :boards, only: %i[index show create destroy] do
    member do
      get :state
      post :add_page
      patch :save_page
      post :save_page
      delete "pages/:page_id", to: "boards#remove_page", as: :remove_page
      post :update_permissions
    end
  end
end
