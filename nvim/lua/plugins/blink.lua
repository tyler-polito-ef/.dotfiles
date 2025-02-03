return {
  "saghen/blink.cmp",
  opts = {
    keymap = {
      preset = "none", -- "super-tab"
      ["<Tab>"] = {},
      ["<S-Tab>"] = {},
      ["<C-y>"] = { "select_and_accept" },
      ["<CR>"] = { "accept" },
      ["<C-j>"] = { "select_next" },
      ["<C-K>"] = { "select_prev" },
    },
  },
}
