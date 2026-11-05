# What a run's coach runs in: the Node the engine asks for, Claude Code and a git identity.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm
RUN npm i -g @anthropic-ai/claude-code \
  && git config --system user.name Persona \
  && git config --system user.email persona@example.com \
  && git config --system --add safe.directory '*'
USER node
