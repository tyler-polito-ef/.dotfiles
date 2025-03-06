-- Disable plugins that come default I don't want
return {
  -- disable neo tree
  { "nvim-neo-tree/neo-tree.nvim", enabled = false },
  -- disable which key
  { "folke/which-key.nvim", enabled = false },
  -- disable copilot completions inside dropdown menu
  { "zbirenbaum/copilot-cmp", enabled = false },
}
