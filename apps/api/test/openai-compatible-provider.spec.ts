import { AiChannel } from "../generated/prisma/client";
import { OpenAiCompatibleProvider } from "../src/ai/providers/openai-compatible.provider";

describe("OpenAiCompatibleProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("should read text from responses style payload when chat content is empty", async () => {
    const provider = new OpenAiCompatibleProvider();
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");

      return new Response(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          model: "gpt-5.4",
          output: [
            {
              id: "msg_123",
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "今天优先先完成截止时间最近的任务。"
                }
              ]
            }
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 9,
            total_tokens: 24
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    global.fetch = fetchMock as typeof global.fetch;

    const result = await provider.execute(
      {
        channel: AiChannel.USER_KEY,
        source: "binding",
        sourceId: "binding_user_key_1",
        providerName: "airouter",
        model: "gpt-5.4",
        configId: null,
        configName: null,
        endpoint: "https://api.airouter.io/v1",
        apiKey: "sk_test"
      },
      {
        userId: "user_1",
        message: "帮我安排今天的任务",
        sessionId: null
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("今天优先先完成截止时间最近的任务。");
    expect(result.model).toBe("gpt-5.4");
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 9,
      totalTokens: 24
    });
  });
});
