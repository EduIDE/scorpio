import * as vscode from "vscode";
import { EventEmitter } from "vscode";
import { AUTH_ID } from "../authentication/authentication_provider";
import WebSocket from "ws";
import { settings } from "./settings";
// @ts-expect-error No type declarations
import * as StompJs from "@stomp/stompjs";

export type WebSocketConnectionState = "disconnected" | "connecting" | "connected" | "error";

export class GenericWebSocket {
  static #instance: GenericWebSocket | undefined;

  private stompClient: any;
  private setupPromise: Promise<void> | undefined;
  private connectionState: WebSocketConnectionState = "disconnected";
  private subscriptions = new Map<string, EventEmitter<any>>();
  private topicSubscriptions = new Map<string, any>();
  private readonly stateChangeEmitter = new EventEmitter<WebSocketConnectionState>();
  private readonly connectedEmitter = new EventEmitter<void>();

  private constructor() {
    // use GenericWebSocket.instance
  }

  public static get instance(): GenericWebSocket {
    if (!GenericWebSocket.#instance) {
      GenericWebSocket.#instance = new GenericWebSocket();
    }
    return GenericWebSocket.#instance;
  }

  public get connected(): boolean {
    return this.stompClient && this.stompClient.connected;
  }

  public get onConnectionStateChange(): vscode.Event<WebSocketConnectionState> {
    return this.stateChangeEmitter.event;
  }

  public async ensureConnection(): Promise<void> {
    await this.setup();
    if (this.connected || this.connectionState === "connecting") {
      return;
    }

    this.setConnectionState("connecting");
    this.stompClient.activate();
  }

  public async awaitConnected(timeoutMs: number = 10000): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    const startTime = Date.now();
    await this.ensureConnection();

    if (this.connected) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const elapsedMs = Date.now() - startTime;
      const remainingTimeoutMs = Math.max(0, timeoutMs - elapsedMs);

      const timeout = setTimeout(() => {
        disposable.dispose();
        resolve(false);
      }, remainingTimeoutMs);

      const disposable = this.connectedEmitter.event(() => {
        clearTimeout(timeout);
        disposable.dispose();
        resolve(true);
      });
    });
  }

  private async setup() {
    if (this.setupPromise) {
      return this.setupPromise;
    }

    this.setupPromise = this.createClient().catch((error) => {
      this.setupPromise = undefined;
      throw error;
    });
    return this.setupPromise;
  }

  private async createClient() {
    const session = await vscode.authentication.getSession(AUTH_ID, [], {
      createIfNone: false,
    });

    if (!session) {
      throw Error("Not authenticated");
    }

    const url = new URL(settings.base_url!);
    url.pathname = "/websocket/websocket";

    this.stompClient = new StompJs.Client({
      brokerURL: url.toString(),
      webSocketFactory: () =>
        new WebSocket(url, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
      connectHeaders: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      // Security: never forward STOMP frames to the log. The CONNECT frame carries the
      // Authorization header (the Artemis JWT), so logging frames leaks the token. Keep this
      // a no-op so the access token is never written to the debug console.
      debug: () => {},
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
    });

    this.stompClient.onConnect = (frame: any) => {
      this.onConnect(frame);
    };
    this.stompClient.onDisconnect = () => {
      this.setConnectionState("disconnected");
    };
    this.stompClient.onWebSocketClose = () => {
      this.setConnectionState("disconnected");
    };
    this.stompClient.onWebSocketError = (_event: Event) => {
      this.setConnectionState("error");
    };
    this.stompClient.onStompError = (frame: any) => {
      console.error(`Error: ${frame.body}`);
      this.setConnectionState("error");
    };
  }

  public subscribeToTopic<T>(topic: string): EventEmitter<T> {
    if (this.subscriptions.has(topic)) {
      return this.subscriptions.get(topic)!;
    }

    if (!this.connected) {
      throw Error(`Cannot subscribe to topic ${topic}: WebSocket is not connected.`);
    }

    const subscription = new EventEmitter<T>();
    this.subscriptions.set(topic, subscription);

    this.subscribeInternal(topic, subscription);
    console.debug(`Subscribed to topic: ${topic}`);
    return subscription;
  }

  public sendMessage(topic: string, message: object): void {
    if (!this.connected) {
      console.error("Cannot send message: WebSocket is not connected.");
      return;
    }

    this.stompClient.publish({
      destination: topic,
      body: JSON.stringify(message),
    });
  }

  public disconnect(): void {
    this.stompClient?.deactivate();
    this.setConnectionState("disconnected");
  }

  private setConnectionState(nextState: WebSocketConnectionState) {
    if (this.connectionState === nextState) {
      return;
    }
    this.connectionState = nextState;
    this.stateChangeEmitter.fire(nextState);
  }

  private onConnect(_frame: any) {
    this.setConnectionState("connected");
    this.connectedEmitter.fire();

    for (const [topic, emitter] of this.subscriptions.entries()) {
      this.subscribeInternal(topic, emitter);
    }
  }

  private subscribeInternal<T>(topic: string, subscription: EventEmitter<T>) {
    this.topicSubscriptions.get(topic)?.unsubscribe();

    const stompSubscription = this.stompClient.subscribe(topic, (message: any) => {
      try {
        const json = JSON.parse(message.body);
        subscription.fire(json as T);
      } catch (error) {
        console.error(`Failed to parse websocket message from ${topic}`, error);
      }
    });

    this.topicSubscriptions.set(topic, stompSubscription);
  }
}
