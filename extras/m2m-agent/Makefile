IMAGE_NAME  ?= m2m-agent
IMAGE_TAG   ?= latest
NAMESPACE   ?= agentgateway-system
PLATFORMS   ?= linux/amd64,linux/arm64

.PHONY: build deploy undeploy logs

build: ## Build multi-arch image (amd64 + arm64)
	docker buildx build --platform $(PLATFORMS) \
		--load -t $(IMAGE_NAME):$(IMAGE_TAG) server/

deploy: ## Deploy the M2M agent to K8s
	kubectl apply -f config/serviceaccount.yaml
	kubectl apply -f config/service.yaml
	sed 's|image: m2m-agent:latest|image: $(IMAGE_NAME):$(IMAGE_TAG)|' \
		config/deployment.yaml | kubectl apply -f -
	kubectl rollout status deployment/m2m-agent -n $(NAMESPACE) --timeout=60s

undeploy: ## Remove the M2M agent from K8s
	kubectl delete -f config/deployment.yaml --ignore-not-found
	kubectl delete -f config/service.yaml --ignore-not-found
	kubectl delete -f config/serviceaccount.yaml --ignore-not-found

logs: ## Tail the M2M agent logs
	kubectl logs -n $(NAMESPACE) deploy/m2m-agent -f --tail=50
