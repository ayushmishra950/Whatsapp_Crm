import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { resolveSession } from '../middleware/auth.js';

let io;

const rooms = {
  tenantAdmins: (tenantId) => `tenant:${tenantId}:admins`,
  tenantAgents: (tenantId) => `tenant:${tenantId}:agents`,
  user: (userId) => `user:${userId}`,
};

export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.clientUrl, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const session = await resolveSession(socket.handshake.auth?.token);
      socket.data.user = session.user;
      socket.data.tenantId = session.tenant?._id;
      next();
    } catch (err) {
      next(new Error(err.message));
    }
  });

  io.on('connection', (socket) => {
    const { user, tenantId } = socket.data;
    socket.join(rooms.user(user._id));
    if (tenantId) {
      socket.join(user.role === 'admin' ? rooms.tenantAdmins(tenantId) : rooms.tenantAgents(tenantId));
    }
  });

  return io;
}

/**
 * Emit a conversation-scoped event only to people allowed to see that conversation:
 * admins always, the assigned agent, or all agents when the chat is unassigned.
 * `previousAssignee` lets a reassigned agent's UI drop the chat.
 * `wasUnassigned` also tells every agent, so the ones who saw it in the unassigned queue can drop it.
 */
export function emitConversationEvent(conversation, event, payload, { previousAssignee, wasUnassigned } = {}) {
  if (!io) return;
  const tenantId = String(conversation.tenantId);
  const assignee = conversation.assignedTo?._id || conversation.assignedTo;
  let target = io.to(rooms.tenantAdmins(tenantId));
  target = assignee ? target.to(rooms.user(assignee)) : target.to(rooms.tenantAgents(tenantId));
  if (previousAssignee && String(previousAssignee) !== String(assignee)) target = target.to(rooms.user(previousAssignee));
  if (wasUnassigned) target = target.to(rooms.tenantAgents(tenantId));
  target.emit(event, payload);
}

export function emitToTenantAdmins(tenantId, event, payload) {
  io?.to(rooms.tenantAdmins(String(tenantId))).emit(event, payload);
}
