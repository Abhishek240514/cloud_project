import { useEffect, useRef, useState } from "react";
import { snapshotAssembler } from "./protocol.js";
const wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
export function useBoard(boardId) {
  const [board, setBoard] = useState(null),
    [status, setStatus] = useState("disconnected");
  const [error, setError] = useState(""),
    [pending, setPending] = useState([]);
  const socket = useRef(null),
    current = useRef(null),
    outbox = useRef(new Map());
  useEffect(() => {
    let stopped = false,
      retry,
      heartbeat,
      watchdog,
      attempts = 0,
      lastMessage = Date.now();
    const assemble = snapshotAssembler();
    current.current = null;
    setBoard(null);
    outbox.current.clear();
    setPending([]);
    setError("");
    if (!wsUrl || wsUrl.includes("YOUR_")) {
      setStatus("unconfigured");
      return;
    }
    function connect() {
      setStatus(attempts ? "reconnecting" : "connecting");
      let ws,
        needsReplay = true;
      try {
        const url = new URL(wsUrl);
        url.searchParams.set("boardId", boardId);
        ws = new WebSocket(url);
      } catch {
        setError("Invalid WebSocket configuration. Check frontend/.env.local.");
        setStatus("disconnected");
        return;
      }
      socket.current = ws;
      ws.onopen = () => {
        lastMessage = Date.now();
        ws.send(JSON.stringify({ action: "sync" }));
      };
      ws.onmessage = (event) => {
        if (stopped || socket.current !== ws) return;
        lastMessage = Date.now();
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "error") {
          setError(message.message);
          if (message.requestId) outbox.current.delete(message.requestId);
          setPending(
            [...outbox.current.values()].map((x) => x.element).filter(Boolean),
          );
          ws.send(JSON.stringify({ action: "sync" }));
          return;
        }
        if (message.type === "ack") {
          outbox.current.delete(message.requestId);
          setPending(
            [...outbox.current.values()].map((x) => x.element).filter(Boolean),
          );
          return;
        }
        const next = assemble(message);
        if (
          !next ||
          next.boardId !== boardId ||
          (current.current && next.revision < current.current.revision)
        )
          return;
        const first = needsReplay;
        needsReplay = false;
        if (first) setError("");
        current.current = next;
        setBoard(next);
        setStatus("connected");
        attempts = 0;
        const ids = new Set(next.elements.map((x) => x.id));
        for (const [id, operation] of outbox.current) {
          if (operation.epoch !== next.epoch || ids.has(id))
            outbox.current.delete(id);
        }
        setPending(
          [...outbox.current.values()].map((x) => x.element).filter(Boolean),
        );
        if (first)
          for (const operation of outbox.current.values())
            ws.send(JSON.stringify(operation));
      };
      ws.onerror = () =>
        setError("Connection interrupted. Retrying automatically.");
      ws.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        retry = setTimeout(
          connect,
          Math.min(15000, 700 * 2 ** attempts++) + Math.random() * 300,
        );
      };
    }
    connect();
    heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "sync" }));
        for (const op of outbox.current.values()) ws.send(JSON.stringify(op));
      }
    }, 15000);
    watchdog = setInterval(() => {
      if (
        socket.current?.readyState === WebSocket.OPEN &&
        Date.now() - lastMessage > 45000
      )
        socket.current.close();
    }, 5000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      clearInterval(watchdog);
      socket.current?.close();
    };
  }, [boardId]);
  function send(operation) {
    if (
      socket.current?.readyState !== WebSocket.OPEN ||
      !current.current ||
      status !== "connected"
    )
      return false;
    if (outbox.current.size >= 40) {
      setError(
        "Waiting for the server to save your changes. Please pause drawing.",
      );
      return false;
    }
    const requestId = operation.element?.id || crypto.randomUUID();
    const message = { ...operation, requestId, epoch: current.current.epoch };
    outbox.current.set(requestId, message);
    setPending(
      [...outbox.current.values()].map((x) => x.element).filter(Boolean),
    );
    socket.current.send(JSON.stringify(message));
    return true;
  }
  return { board, status, error, setError, pending, send };
}
