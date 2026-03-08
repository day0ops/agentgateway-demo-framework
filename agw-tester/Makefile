.PHONY: dev dev-server dev-ui build build-server build-ui deploy undeploy clean install

# Development
dev: install
	@echo "Starting development servers..."
	@$(MAKE) -j2 dev-server dev-ui

dev-server:
	@echo "Starting backend server..."
	@cd server && bun run dev

dev-ui:
	@echo "Starting UI dev server..."
	@cd ui && bun run dev

# Installation
install:
	@echo "Installing dependencies..."
	@cd server && bun install
	@cd ui && bun install

# Build
build: build-server build-ui
	@echo "Build complete"

build-server:
	@echo "Building server..."
	@cd server && bun run build

build-ui:
	@echo "Building UI..."
	@cd ui && bun run build

# Docker
IMAGE_NAME ?= agw-tester
IMAGE_TAG ?= latest

docker-build:
	@echo "Building Docker image..."
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

# Kubernetes deployment
deploy:
	@echo "Deploying to Kubernetes..."
	kubectl apply -f k8s/

undeploy:
	@echo "Removing from Kubernetes..."
	kubectl delete -f k8s/ --ignore-not-found

# Cleanup
clean:
	@echo "Cleaning build artifacts..."
	rm -rf server/dist ui/dist node_modules server/node_modules ui/node_modules
