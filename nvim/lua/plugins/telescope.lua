return {
  "nvim-telescope/telescope.nvim",
  keys = {
    -- disable defaults
    { "<leader>ff", false },
    -- change a keymap
    { "<C-p>", "<cmd>Telescope find_files<cr>", desc = "Find Files" },
    { "<leader>ff", "<cmd>Telescope live_grep<cr>", desc = "Live grep" },
  },
  opts = {
    defaults = {
      file_ignore_patterns = { "node_modules", ".git", "gat%-web" },
    },
  },
}
