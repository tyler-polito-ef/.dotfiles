return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    local keys = require("lazyvim.plugins.lsp.keymaps").get()
    keys[#keys + 1] = { "<C-k>", false, mode = { "i" } }
    opts.inlay_hints = { enabled = false }
    return opts
  end,
}
