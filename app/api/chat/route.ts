import { OpenAI } from 'openai';
import { getAvailability } from '@/lib/googleSheets';
import { retrieveContext } from '@/lib/rag';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: ChatMessage[] };
    if (!messages || messages.length === 0) {
      throw new Error("No messages provided");
    }

    const lastMessage = messages[messages.length - 1];
    
    // Log analytics: message handled
    try {
      await fetch(`${req.url.replace('/chat', '/analytics')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'message_handled',
          metadata: { message_length: String(lastMessage.content).length },
        }),
      });
    } catch {
      // Silent fail for analytics
    }
    
    // RAG Step - only for user messages
    let context = "";
    if (lastMessage.role === 'user') {
      const userContent = Array.isArray(lastMessage.content)
        ? lastMessage.content
            .map((part) =>
              typeof part === 'string'
                ? part
                : part.type === 'text'
                  ? part.text ?? ''
                  : ''
            )
            .join(' ')
            .trim()
        : (lastMessage.content as string | undefined) ?? '';

      if (userContent) {
        context = await retrieveContext(userContent);
      }
    }
    
    const systemPrompt = `You are a helpful virtual assistant for Amity Global Institute in Singapore.
    
    IDENTITY:
    - You represent Amity Global Institute, part of the Amity Education Group.
    - Your role is to answer questions about programmes, admissions, campus, and student life.

    STYLE:
    - Keep answers SHORT, CLEAR, and ACCURATE.
    - Be friendly, professional, and direct.
    - Use simple English that international students can understand.

    CORE RULES:
    1. CAREFULLY READ the Knowledge Base context below. It contains Q&A pairs about Amity.
    2. If the user's question matches or is similar to a question in the Knowledge Base, USE THAT ANSWER.
    3. If NO relevant information is found in the Knowledge Base, then say:
       "I don't have that information. Please contact our admissions team at +65 6602 9500 or info@singapore.amity.edu."
    4. NEVER make up information. If unsure, redirect to staff contact.
    5. For questions about fees, requirements, or schedules, it's okay to give general guidance from the Knowledge Base AND suggest contacting admissions for specifics.
    6. Be encouraging – Amity welcomes students from 42+ countries!
    
    Today is ${new Date().toISOString()}.
    
    Knowledge Base Context (Q&A pairs):
    ${context}
    
    Instructions: Read the Knowledge Base carefully. If you find a relevant answer, use it. If not, politely redirect to admissions.
    `;

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "getAvailability",
          description: "Check available consultation or event slots (if applicable).",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              subject: { type: "string", description: "Event or consultation type" },
            },
            required: ["date", "subject"],
          },
        },
      },
    ];

    // Initial call to DeepSeek
    // We construct the full message history for the API call
    const currentMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    let response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: currentMessages,
      tools,
    });

    let message = response.choices[0].message;

    // Tool execution loop
    // Limit loop to prevent infinite loops
    let loopCount = 0;
    while (message.tool_calls && loopCount < 5) {
      loopCount++;
      const toolCalls = message.tool_calls;
      
      // Append the assistant's message (with tool calls) to the history
      currentMessages.push(message as ChatMessage);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function' || !toolCall.function) {
          continue;
        }

        const { name: functionName, arguments: functionArgs } = toolCall.function;
        const args = functionArgs
          ? (JSON.parse(functionArgs) as Record<string, unknown>)
          : {};
        let result: unknown;

        console.log(`Executing tool: ${functionName} with args:`, args);

        try {
          if (functionName === 'getAvailability') {
            result = await getAvailability(
              args.date as string,
              args.subject as string
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result = { error: message };
        }

        // Append tool result to history
        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Call DeepSeek again with tool results
      response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: currentMessages,
        tools,
      });

      message = response.choices[0].message;
    }

    // Check if response contains contact info
    const responseText = message.content?.toString().toLowerCase() || '';
    if (
      responseText.includes('+65 6602 9500') ||
      responseText.includes('info@singapore.amity.edu') ||
      responseText.includes('contact')
    ) {
      try {
        await fetch(`${req.url.replace('/chat', '/analytics')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'contact_request',
            metadata: { triggered_by: 'ai_response' },
          }),
        });
      } catch {
        // Silent fail
      }
    }

    return Response.json(message);
  } catch (error) {
    console.error("Error in chat route:", error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
