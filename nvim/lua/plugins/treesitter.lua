return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	config = function()
		local configs = require("nvim-treesitter.configs")
		configs.setup({
			ensure_installed = { "lua", "javascript", "vimdoc", "vim", "svelte", "typescript", "html", "gleam", "tsx", "css" },
			highlight = { enable = true },
			indent = { enable = true },
			autopairs = { enable = true },
		})
	end,
}
