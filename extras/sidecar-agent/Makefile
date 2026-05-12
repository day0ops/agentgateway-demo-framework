IMAGE_REPO  ?=
IMAGE_PREFIX := $(if $(IMAGE_REPO),$(IMAGE_REPO)/,)
IMAGE_NAME  ?= sidecar-agent
IMAGE_TAG   ?= latest
NAMESPACE   ?= agentgateway-system
PLATFORMS   ?= linux/amd64,linux/arm64
REPO_ROOT   := $(abspath $(CURDIR)/../..)

.PHONY: build push deploy undeploy logs

build: ## Build multi-arch image (amd64 + arm64)
	docker buildx build --platform $(PLATFORMS) \
		--load -t $(IMAGE_PREFIX)$(IMAGE_NAME):$(IMAGE_TAG) server/

push: ## Build and push multi-arch image (amd64 + arm64)
	@$(MAKE) -C $(REPO_ROOT) container-multiarch-push \
		CONTAINER_MULTIARCH_IMAGE=$(IMAGE_PREFIX)$(IMAGE_NAME):$(IMAGE_TAG) \
		CONTAINER_MULTIARCH_CONTEXT=extras/sidecar-agent/server \
		DOCKER_BUILD_FLAGS="$(DOCKER_BUILD_FLAGS)" \
		PODMAN_MANIFEST_PUSH_FLAGS="$(PODMAN_MANIFEST_PUSH_FLAGS)"

deploy: ## Deploy the sidecar agent to K8s (standalone, without sidecar feature)
	kubectl apply -f config/serviceaccount.yaml
	kubectl apply -f config/service.yaml
	sed 's|image: sidecar-agent:latest|image: $(IMAGE_PREFIX)$(IMAGE_NAME):$(IMAGE_TAG)|' \
		config/deployment.yaml | kubectl apply -f -
	kubectl rollout status deployment/sidecar-agent -n $(NAMESPACE) --timeout=60s

undeploy: ## Remove the sidecar agent from K8s
	kubectl delete -f config/deployment.yaml --ignore-not-found
	kubectl delete -f config/service.yaml --ignore-not-found
	kubectl delete -f config/serviceaccount.yaml --ignore-not-found

logs: ## Tail the sidecar agent logs
	kubectl logs -n $(NAMESPACE) deploy/sidecar-agent -f --tail=50
