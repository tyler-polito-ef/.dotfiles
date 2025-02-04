return {
  "saghen/blink.cmp",
  opts = {
    keymap = {
      preset = "enter", -- "super-tab"
      ["<Tab>"] = {},
      ["<S-Tab>"] = {},
      ["<C-y>"] = { "select_and_accept" },
      ["<CR>"] = {},
      ["<C-j>"] = { "select_next" },
      ["<C-k>"] = { "select_prev" },
    },
    completion = {
      menu = {
        border = "rounded",
      },
      documentation = {
        window = {
          border = "rounded",
        },
      },
      ghost_text = {
        enabled = false,
      },
    },
  },
}
