return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPost" },
		cmd = { "LspInfo", "LspInstall", "LspUninstall", "Mason" },
		dependencies = {
			-- Plugin and UI to automatically install LSPs to stdpath
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",

			"hrsh7th/cmp-nvim-lsp",
			-- Install none-ls for diagnostics, code actions, and formatting
			"nvimtools/none-ls.nvim",

			-- Progress/Status update for LSP
			{ "j-hui/fidget.nvim", tag = "legacy" },
		},
		config = function()
			local null_ls = require("null-ls")
			vim.keymap.set("n", "K", vim.lsp.buf.hover, {})
			vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, {})
			vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, {})
			vim.keymap.set("n", "gd", vim.lsp.buf.definition, {})
			vim.keymap.set("n", "<leader>lf", vim.lsp.buf.format, {})

			-- Setup mason so it can manage 3rd party LSP servers
			require("mason").setup({
				ui = {
					border = "rounded",
				},
			})

			-- Configure mason to auto install servers
			require("mason-lspconfig").setup({
				automatic_installation = {
					exclude = {
						"gleam",
					},
				},
			})

			-- LSP servers to install (see list here: https://github.com/williamboman/mason-lspconfig.nvim#available-lsp-servers )
			local servers = {
				cssls = {},
				gleam = {},
				graphql = {},
				html = {},
				jsonls = {},
				lua_ls = {
					settings = {
						Lua = {
							workspace = { checkThirdParty = false },
							telemetry = { enabled = false },
						},
					},
				},
				marksman = {},
				sqlls = {},
				tailwindcss = {
					-- filetypes = { "reason" },
				},
				svelte = {},
				tsserver = {
					settings = {
						experimental = {
							enableProjectDiagnostics = true,
						},
					},
				},
				yamlls = {},
			}

			-- Default handlers for LSP
			local default_handlers = {
				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
				["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, { border = "rounded" }),
			}

			-- nvim-cmp supports additional completion capabilities
			local capabilities = vim.lsp.protocol.make_client_capabilities()
			local default_capabilities = require("cmp_nvim_lsp").default_capabilities(capabilities)

			-- Iterate over our servers and set them up
			for name, config in pairs(servers) do
				require("lspconfig")[name].setup({
					capabilities = default_capabilities,
					filetypes = config.filetypes,
					handlers = vim.tbl_deep_extend("force", {}, default_handlers, config.handlers or {}),
					on_attach = on_attach,
					settings = config.settings,
				})
			end

			-- Congifure LSP linting, formatting, diagnostics, and code actions
			local formatting = null_ls.builtins.formatting
			local diagnostics = null_ls.builtins.diagnostics
			local code_actions = null_ls.builtins.code_actions

			null_ls.setup({
				border = "rounded",
				sources = {
					-- formatting
					formatting.prettier,
					formatting.stylua,
				},
			})

			-- Configure borderd for LspInfo ui
			require("lspconfig.ui.windows").default_options.border = "rounded"

			-- Configure diagostics border
			vim.diagnostic.config({
				float = {
					border = "rounded",
				},
			})
		end,
	},
}
