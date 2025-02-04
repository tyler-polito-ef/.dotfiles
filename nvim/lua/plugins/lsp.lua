return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    local keys = require("lazyvim.plugins.lsp.keymaps").get()
    keys[#keys + 1] = { "<C-k>", false, mode = { "i" } }

    opts.inlay_hints = { enabled = false }

    return opts
  end,
  init = function()
    vim.api.nvim_create_autocmd("FileType", {
      pattern = "gdscript",
      callback = function()
        vim.bo.tabstop = 2
        vim.bo.shiftwidth = 2
        vim.bo.expandtab = false -- Use spaces instead of tabs
      end,
    })
  end,
}
