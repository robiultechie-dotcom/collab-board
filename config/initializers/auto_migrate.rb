# frozen_string_literal: true

Rails.application.config.after_initialize do
  ActiveRecord::Base.connection_pool.with_connection do |conn|
    if conn.table_exists?(:boards) && conn.column_exists?(:boards, :default_role)
      conn.drop_table(:board_permissions, if_exists: true)
      conn.drop_table(:board_pages, if_exists: true)
      conn.drop_table(:boards, if_exists: true)
    end

    unless conn.table_exists?(:boards)
      conn.create_table :boards do |t|
        t.string :title, null: false
        t.string :owner_nickname, null: false
        t.string :access_level, null: false, default: "manager"
        t.text :thumbnail
        t.timestamps
      end
    end

    unless conn.table_exists?(:board_pages)
      conn.create_table :board_pages do |t|
        t.references :board, null: false, foreign_key: true
        t.integer :position, null: false, default: 1
        t.text :canvas_data
        t.text :thumbnail
        t.timestamps
      end
    end

    unless conn.table_exists?(:board_permissions)
      conn.create_table :board_permissions do |t|
        t.references :board, null: false, foreign_key: true
        t.string :nickname, null: false
        t.string :role, null: false, default: "manager"
        t.timestamps
      end
    end
  end
rescue StandardError => e
  Rails.logger.warn("Schema setup warning: #{e.message}")
end
