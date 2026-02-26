.PHONY: help install start stop status clean clean-usecases clean-addons clean-infra test lint format deploy-usecase dryrun-usecase \
	build-extras build-stock-server-mcp build-currency-server-mcp build-random-server-mcp build-guardrail-webhook build-stock-agent \
	deploy-stock-server-mcp deploy-currency-server-mcp deploy-random-server-mcp deploy-guardrail-webhook deploy-stock-agent \
	undeploy-stock-server-mcp undeploy-currency-server-mcp undeploy-random-server-mcp undeploy-guardrail-webhook undeploy-stock-agent
.DEFAULT_GOAL := help

BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

CLI_VERSION := $(shell bun src/cli.js version --short 2>/dev/null | head -1)
CLI_DESCRIPTION := $(shell bun src/cli.js version --short 2>/dev/null | sed -n '2p')

##@ General

help: ## Display this help message
	@echo "$(BLUE)Agentgateway Demo Framework v$(CLI_VERSION)$(NC)"
	@echo "$(BLUE)$(CLI_DESCRIPTION)$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make $(GREEN)<target>$(NC)\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(BLUE)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

version: ## Show version information (banner, version, description)
	@bun src/cli.js version

##@ Setup

install-infra: ## Install infrastructure (lok8s cluster)
	@bun src/cli.js base install-infra

install-gateway: ## Install kgateway and agentgateway
	@bun src/cli.js base install-gateway

install-gateway-minimal: ## Install kgateway with minimal profile
	@echo "$(BLUE)Installing gateway with minimal profile...$(NC)"
	@bun src/cli.js base install-gateway --profile minimal --no-prompt

install: ## Install everything (minimal profile)
	@echo "$(BLUE)Installing complete stack with minimal profile...$(NC)"
	@bun src/cli.js base install --profile minimal --no-prompt

install-interactive: ## Install everything (interactive)
	@echo "$(BLUE)Installing complete stack...$(NC)"
	@bun run setup

start: ## Start lok8s cluster
	@echo "$(BLUE)Starting lok8s cluster...$(NC)"
	@bun src/cli.js base start

stop: ## Stop lok8s cluster
	@echo "$(BLUE)Stopping lok8s cluster...$(NC)"
	@bun src/cli.js base stop

status: ## Show infrastructure status
	@bun src/cli.js base status

##@ Profiles

list-profiles: ## List available installation profiles
	@bun src/cli.js profile list

##@ Use Cases

list-usecases:
	@bun src/cli.js usecase list

deploy-usecase: ## Deploy a use case (USECASE=name)
	@if [ -z "$(USECASE)" ]; then \
		HIDE_DIAGRAMS=$(HIDE_DIAGRAMS) bun src/cli.js usecase deploy; \
	else \
		HIDE_DIAGRAMS=$(HIDE_DIAGRAMS) bun src/cli.js usecase deploy --name $(USECASE); \
	fi

dryrun-usecase: ## Dry-run a use case (USECASE=name)
	@if [ -z "$(USECASE)" ]; then \
		bun src/cli.js usecase dryrun; \
	else \
		bun src/cli.js usecase dryrun --name $(USECASE); \
	fi

test-usecase:
	@if [ -z "$(USECASE)" ]; then \
		bun src/cli.js usecase test; \
	else \
		bun src/cli.js usecase test $(USECASE); \
	fi

##@ Providers

list-providers: ## List configured LLM providers
	@bun src/cli.js provider list

list-provider-groups: ## List provider groups
	@echo "$(YELLOW)Provider management coming soon in JavaScript$(NC)"

##@ Features

list-features: ## List available features
	@bun src/cli.js feature list

##@ Development

port-forward: ## Port forward to agentgateway (localhost:8080)
	@echo "$(BLUE)Port forwarding to agentgateway on :8080$(NC)"
	@kubectl port-forward -n kgateway-system deployment/agentgateway 8080:8080

metrics: ## Port forward to metrics (localhost:9091)
	@echo "$(BLUE)Port forwarding to metrics on :9091$(NC)"
	@kubectl port-forward -n kgateway-system svc/agentgateway-metrics 9091:9091

traces: ## Port forward to Jaeger UI (localhost:16686)
	@echo "$(BLUE)Port forwarding to Jaeger UI on :16686$(NC)"
	@kubectl port-forward -n observability svc/jaeger 16686:16686

##@ Testing

test: ## Run all tests
	@echo "$(BLUE)Running tests...$(NC)"
	@bun test

lint:
	@echo "$(BLUE)Linting JavaScript...$(NC)"
	@bun run lint

format:
	@echo "$(BLUE)Formatting code...$(NC)"
	@bun run format

##@ Cleanup

clean-usecases: ## Clean up deployed use cases
	@echo "$(BLUE)Cleaning up deployed use case(s)...$(NC)"
	@bun src/cli.js usecase cleanup --all --no-prompt

clean-addons: ## Clean up all profile-based addons
	@echo "$(BLUE)Cleaning up all addons...$(NC)"
	@bun src/cli.js base clean-addons

clean-infra: ## Remove lok8s cluster
	@bun src/cli.js base clean-infra

clean: ## Clean up everything
	@bun src/cli.js base cleanup

##@ Extras

build-extras: ## Build all extras images
	@echo "$(BLUE)Building all extras...$(NC)"
	@$(MAKE) -C extras/stock-server-mcp build
	@$(MAKE) -C extras/currency-server-mcp build
	@$(MAKE) -C extras/random-server-mcp build
	@$(MAKE) -C extras/guardrail-webhook build
	@$(MAKE) -C extras/stock-agent build

build-stock-server-mcp: ## Build the stock MCP server image
	@$(MAKE) -C extras/stock-server-mcp build

build-currency-server-mcp: ## Build the currency MCP server image
	@$(MAKE) -C extras/currency-server-mcp build

build-random-server-mcp: ## Build the random MCP server image
	@$(MAKE) -C extras/random-server-mcp build

build-guardrail-webhook: ## Build the guardrail webhook image
	@$(MAKE) -C extras/guardrail-webhook build

build-stock-agent: ## Build the stock agent image
	@$(MAKE) -C extras/stock-agent build

deploy-stock-server-mcp: ## Deploy the stock MCP server to K8s
	@$(MAKE) -C extras/stock-server-mcp deploy

deploy-currency-server-mcp: ## Deploy the currency MCP server to K8s
	@$(MAKE) -C extras/currency-server-mcp deploy

deploy-random-server-mcp: ## Deploy the random MCP server to K8s
	@$(MAKE) -C extras/random-server-mcp deploy

deploy-guardrail-webhook: ## Deploy the guardrail webhook to K8s
	@$(MAKE) -C extras/guardrail-webhook deploy

deploy-stock-agent: ## Deploy the stock agent to K8s
	@$(MAKE) -C extras/stock-agent deploy

undeploy-stock-server-mcp: ## Remove the stock MCP server from K8s
	@$(MAKE) -C extras/stock-server-mcp undeploy

undeploy-currency-server-mcp: ## Remove the currency MCP server from K8s
	@$(MAKE) -C extras/currency-server-mcp undeploy

undeploy-random-server-mcp: ## Remove the random MCP server from K8s
	@$(MAKE) -C extras/random-server-mcp undeploy

undeploy-guardrail-webhook: ## Remove the guardrail webhook from K8s
	@$(MAKE) -C extras/guardrail-webhook undeploy

undeploy-stock-agent: ## Remove the stock agent from K8s
	@$(MAKE) -C extras/stock-agent undeploy

##@ Utilities

check-deps:
	@bun src/cli.js check-deps

env-example:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(GREEN)Created .env file. Please edit it with your API keys.$(NC)"; \
	else \
		echo "$(YELLOW).env file already exists$(NC)"; \
	fi

load-env:
	@if [ -f .env ]; then \
		export $$(cat .env | grep -v '^#' | xargs); \
		echo "$(GREEN)Environment variables loaded$(NC)"; \
	else \
		echo "$(YELLOW).env file not found. Run 'make env-example' first.$(NC)"; \
	fi

