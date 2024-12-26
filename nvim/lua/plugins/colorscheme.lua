return {
  {
    "Mofiqul/dracula.nvim",
    config = function()
      require("dracula").setup({
        -- Override default colors
        colors = {
          bg = "#1d1f21",
        },
        -- Or use transparent background
        transparent_bg = true, -- Use this if you want transparency
      })
    end,
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "dracula",
    },
  },
}
