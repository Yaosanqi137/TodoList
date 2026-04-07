import { AiChannel } from "../generated/prisma/client";
import { AstrbotProvider } from "../src/ai/providers/astrbot.provider";

describe("AstrbotProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("should not forward binding label fields as astrbot selection parameters", async () => {
    const provider = new AstrbotProvider();
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      expect(payload).toMatchObject({
        username: "user_1",
        session_id: "session_1",
        message: "你好",
        enable_streaming: false,
        selected_model: "deepseek-chat"
      });
      expect(payload).not.toHaveProperty("selected_provider");
      expect(payload).not.toHaveProperty("config_id");
      expect(payload).not.toHaveProperty("config_name");

      return new Response(
        [
          'data: {"type":"session_id","session_id":"session_1"}',
          "",
          'data: {"type":"plain","data":"收到","streaming":false,"chain_type":null}',
          "",
          'data: {"type":"end","data":"","streaming":false}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        }
      );
    });

    global.fetch = fetchMock as typeof global.fetch;

    const result = await provider.execute(
      {
        channel: AiChannel.ASTRBOT,
        source: "binding",
        sourceId: "binding_1",
        providerName: "astrbot-main",
        model: "deepseek-chat",
        configId: "default",
        configName: "默认配置",
        endpoint: "http://127.0.0.1:6185",
        apiKey: "abk_secret"
      },
      {
        userId: "user_1",
        message: "你好",
        sessionId: "session_1"
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("收到");
    expect(result.sessionId).toBe("session_1");
    expect(result.providerName).toBe("astrbot-main");
  });
});
