import { AiChannel } from "../generated/prisma/client";
import { AstrbotProvider } from "../src/ai/providers/astrbot.provider";

describe("AstrbotProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should stop reading once the end event arrives", async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(
            encoder.encode('data: {"type":"session_id","data":null,"session_id":"session_1"}\n\n')
          );
          return;
        }

        if (pullCount === 2) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"plain","data":"TodoList AstrBot 已连接","streaming":false,"chain_type":null}\n\n'
            )
          );
          return;
        }

        if (pullCount === 3) {
          controller.enqueue(
            encoder.encode('data: {"type":"end","data":"","streaming":false}\n\n')
          );
          return;
        }

        return new Promise(() => undefined);
      }
    });

    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream"
        }
      })
    );

    const provider = new AstrbotProvider();

    const result = await Promise.race([
      provider.execute(
        {
          channel: AiChannel.ASTRBOT,
          source: "binding",
          sourceId: "binding_1",
          providerName: "",
          model: null,
          configId: "default",
          configName: null,
          endpoint: "http://127.0.0.1:6185",
          apiKey: "abk_test"
        },
        {
          userId: "user_1",
          message: "ping",
          sessionId: null
        }
      ),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("provider timeout")), 1000);
      })
    ]);

    expect(result.content).toBe("TodoList AstrBot 已连接");
    expect(result.sessionId).toBe("session_1");
    expect(pullCount).toBeGreaterThanOrEqual(3);
  });
});
