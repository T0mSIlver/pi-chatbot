import "server-only";

import {
  type Api,
  type Context,
  type Model,
  registerApiProvider,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@mariozechner/pi-ai";
import {
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai/openai-completions";
import { runWithProviderCapture } from "./provider-capture-transport";
import type { ProviderCaptureContext } from "./provider-captures";

const CAPTURED_OPENAI_COMPLETIONS_API = "openai-completions-captured";
const OPENAI_COMPLETIONS_API = "openai-completions";

const captureContexts = new WeakMap<object, ProviderCaptureContext>();

let registered = false;

function asOpenAICompletionsModel(model: Model<Api>) {
  return {
    ...model,
    api: OPENAI_COMPLETIONS_API,
  } as Model<typeof OPENAI_COMPLETIONS_API>;
}

function runCapturedOpenAICompletions<T>(model: Model<Api>, fn: () => T) {
  const context = captureContexts.get(model);
  if (!context) {
    return fn();
  }

  return runWithProviderCapture(
    context,
    {
      api: OPENAI_COMPLETIONS_API,
      model: model.id,
      provider: model.provider,
    },
    fn
  );
}

export function registerCapturedOpenAICompletionsProvider() {
  if (registered) {
    return;
  }

  registerApiProvider(
    {
      api: CAPTURED_OPENAI_COMPLETIONS_API,
      stream: (
        model: Model<typeof CAPTURED_OPENAI_COMPLETIONS_API>,
        context: Context,
        options?: StreamOptions
      ) =>
        runCapturedOpenAICompletions(model, () =>
          streamOpenAICompletions(
            asOpenAICompletionsModel(model),
            context,
            options
          )
        ),
      streamSimple: (
        model: Model<typeof CAPTURED_OPENAI_COMPLETIONS_API>,
        context: Context,
        options?: SimpleStreamOptions
      ) =>
        runCapturedOpenAICompletions(model, () =>
          streamSimpleOpenAICompletions(
            asOpenAICompletionsModel(model),
            context,
            options
          )
        ),
    },
    "pi-chatbot-provider-captures"
  );

  registered = true;
}

export function withProviderCaptureModel<TApi extends Api>(
  model: Model<TApi> | undefined,
  context: ProviderCaptureContext | undefined
) {
  if (!model || !context || model.api !== OPENAI_COMPLETIONS_API) {
    return model;
  }

  registerCapturedOpenAICompletionsProvider();
  const capturedModel = {
    ...model,
    api: CAPTURED_OPENAI_COMPLETIONS_API,
  } as Model<typeof CAPTURED_OPENAI_COMPLETIONS_API>;

  captureContexts.set(capturedModel, context);
  return capturedModel;
}
