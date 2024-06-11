return {
  'stevearc/oil.nvim',
  opts = {},
  dependencies = { "nvim-tree/nvim-web-devicons" },
  config = function()
	require("oil").setup()
	-- vim.keymap.set('n', '<leader>ef', '<CMD>Oil<CR>', { desc = "Open parent directory" })
	vim.keymap.set('n', '<leader>e', require('oil').toggle_float)
  end
}
