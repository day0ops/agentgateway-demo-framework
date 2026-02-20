.PHONY: help install start stop status clean clean-usecases clean-addons clean-infra test lint format deploy-usecase dryrun-usecase \
	build-extras build-mcp-stock-server build-mcp-currency-server build-mcp-random-server build-guardrail-webhook \
	deploy-mcp-stock-server deploy-mcp-currency-server deploy-mcp-random-server deploy-guardrail-webhook \
	undeploy-mcp-stock-server undeploy-mcp-currency-server undeploy-mcp-random-server undeploy-guardrail-webhook
.DEFAULT_GOAL := help

BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

CLI_VERSION := $(shell node src/cli.js version --short 2>/dev/null | head -1)
CLI_DESCRIPTION := $(shell node src/cli.js version --short 2>/dev/null | sed -n '2p')

##@ General

help: ## Display this help message
	@echo "$(BLUE)Agentgateway Demo Framework v$(CLI_VERSION)$(NC)"
	@echo "$(BLUE)$(CLI_DESCRIPTION)$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make $(GREEN)<target>$(NC)\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(BLUE)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

version: ## Show version information (banner, version, description)
	@node src/cli.js version

##@ Setup

install-infra: ## Install infrastructure (lok8s cluster)
	@node src/cli.js base install-infra

install-gateway: ## Install kgateway and agentgateway
	@node src/cli.js base install-gateway

install-gateway-minimal: ## Install kgateway with minimal profile
	@echo "$(BLUE)Installing gateway with minimal profile...$(NC)"
	@node src/cli.js base install-gateway --profile minimal --no-prompt

install: ## Install everything (minimal profile)
	@echo "$(BLUE)Installing complete stack with minimal profile...$(NC)"
	@node src/cli.js base install --profile minimal --no-prompt

install-interactive: ## Install everything (interactive)
	@echo "$(BLUE)Installing complete stack...$(NC)"
	@npm run setup

start: ## Start lok8s cluster
	@echo "$(BLUE)Starting lok8s cluster...$(NC)"
	@node src/cli.js base start

stop: ## Stop lok8s cluster
	@echo "$(BLUE)Stopping lok8s cluster...$(NC)"
	@node src/cli.js base stop

status: ## Show infrastructure status
	@node src/cli.js base status

##@ Profiles

list-profiles: ## List available installation profiles
	@node src/cli.js profile list

##@ Use Cases

list-usecases:
	@node src/cli.js usecase list

deploy-usecase: ## Deploy a use case (USECASE=name)
	@if [ -z "$(USECASE)" ]; then \
		HIDE_DIAGRAMS=$(HIDE_DIAGRAMS) node src/cli.js usecase deploy; \
	else \
		HIDE_DIAGRAMS=$(HIDE_DIAGRAMS) node src/cli.js usecase deploy --name $(USECASE); \
	fi

dryrun-usecase: ## Dry-run a use case (USECASE=name)
	@if [ -z "$(USECASE)" ]; then \
		node src/cli.js usecase dryrun; \
	else \
		node src/cli.js usecase dryrun --name $(USECASE); \
	fi

test-usecase:
	@if [ -z "$(USECASE)" ]; then \
		node src/cli.js usecase test; \
	else \
		node src/cli.js usecase test $(USECASE); \
	fi

##@ Providers

list-providers: ## List configured LLM providers
	@node src/cli.js provider list

list-provider-groups: ## List provider groups
	@echo "$(YELLOW)Provider management coming soon in JavaScript$(NC)"

##@ Features

list-features: ## List available features
	@node src/cli.js feature list

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
	@npm test

lint:
	@echo "$(BLUE)Linting JavaScript...$(NC)"
	@npm run lint

format:
	@echo "$(BLUE)Formatting code...$(NC)"
	@npm run format

##@ Cleanup

clean-usecases: ## Clean up deployed use cases
	@echo "$(BLUE)Cleaning up deployed use case(s)...$(NC)"
	@node src/cli.js usecase cleanup --all --no-prompt

clean-addons: ## Clean up all profile-based addons
	@echo "$(BLUE)Cleaning up all addons...$(NC)"
	@node src/cli.js base clean-addons

clean-infra: ## Remove lok8s cluster
	@node src/cli.js base clean-infra

clean: ## Clean up everything
	@node src/cli.js base cleanup

##@ Extras

build-extras: ## Build all extras images
	@echo "$(BLUE)Building all extras...$(NC)"
	@$(MAKE) -C extras/mcp-stock-server build
	@$(MAKE) -C extras/mcp-currency-server build
	@$(MAKE) -C extras/mcp-random-server build
	@$(MAKE) -C extras/guardrail-webhook build

build-mcp-stock-server: ## Build the MCP stock server image
	@$(MAKE) -C extras/mcp-stock-server build

build-mcp-currency-server: ## Build the MCP currency server image
	@$(MAKE) -C extras/mcp-currency-server build

build-mcp-random-server: ## Build the MCP random server image
	@$(MAKE) -C extras/mcp-random-server build

build-guardrail-webhook: ## Build the guardrail webhook image
	@$(MAKE) -C extras/guardrail-webhook build

deploy-mcp-stock-server: ## Deploy the MCP stock server to K8s
	@$(MAKE) -C extras/mcp-stock-server deploy

deploy-mcp-currency-server: ## Deploy the MCP currency server to K8s
	@$(MAKE) -C extras/mcp-currency-server deploy

deploy-mcp-random-server: ## Deploy the MCP random server to K8s
	@$(MAKE) -C extras/mcp-random-server deploy

deploy-guardrail-webhook: ## Deploy the guardrail webhook to K8s
	@$(MAKE) -C extras/guardrail-webhook deploy

undeploy-mcp-stock-server: ## Remove the MCP stock server from K8s
	@$(MAKE) -C extras/mcp-stock-server undeploy

undeploy-mcp-currency-server: ## Remove the MCP currency server from K8s
	@$(MAKE) -C extras/mcp-currency-server undeploy

undeploy-mcp-random-server: ## Remove the MCP random server from K8s
	@$(MAKE) -C extras/mcp-random-server undeploy

undeploy-guardrail-webhook: ## Remove the guardrail webhook from K8s
	@$(MAKE) -C extras/guardrail-webhook undeploy

##@ Utilities

check-deps:
	@node src/cli.js check-deps

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

