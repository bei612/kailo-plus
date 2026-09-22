package replaytests

import "go.temporal.io/sdk/workflow"

func workflowRegisterOptions(name string) workflow.RegisterOptions {
	return workflow.RegisterOptions{Name: name}
}
