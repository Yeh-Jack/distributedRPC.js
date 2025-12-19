# Name this image to "reg.enjo.tech/dev-container/vsc-tsnode:22-bookworm-amd64".
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install OS level packages as needed.
RUN export DEBIAN_FRONTEND=noninteractive && \
    # Add Java 21 repository which is required for SonarLint extension.
    apt update && apt-get install -y --no-install-recommends gnupg software-properties-common wget && \
    wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /usr/share/keyrings/adoptium.gpg > /dev/null && \
    echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" | tee /etc/apt/sources.list.d/adoptium.list && \
    apt update && apt upgrade -y && apt-get install -y --no-install-recommends \
        curl git git-lfs htop iftop net-tools netcat-traditional nfs-common nmap rsync traceroute vim \
        dnsutils exfatprogs iputils-ping openssh-server telnet temurin-21-jdk && \
    # Clean up packages and repositories.
    apt-get autoclean && apt-get autoremove && rm -rf /var/lib/apt/lists/*

# Make default shell to zsh which is installed in the base image.
ARG DEF_SHELL="/bin/zsh"
# Define the local deployed LLM server.
ARG LLM_HOST="llm.enjo.tech"
ARG LLM_PORT=443
# Make Node.js default to version 22.
ENV NODE_VERSION=22
RUN \
    # Install the specific version of node.js and pnpm, and configure corepack.
    su node -c ". /usr/local/share/nvm/nvm.sh && nvm install --default ${NODE_VERSION} && nvm use default" && \
    npm install -g pnpm@10.20.0 && \
    corepack enable && corepack use pnpm@10.20.0 && \
    # Change default shell from bash to zsh for the root and node users only.
    sed -i -E "s|^(root:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:).*|\1$DEF_SHELL|" /etc/passwd && \
    sed -i -E "s|^(node:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:).*|\1$DEF_SHELL|" /etc/passwd
    # Construct a SSH local forwarding tunnel to $LLM_HOST if obsence.
#    echo '#nvm alias default $NODE_VERSION && nvm use default\n\n\
#LAN_LLM_HOST="$LLM_HOST"\n\
#if ! nc -z localhost $LLM_PORT; then\n\
#    echo "Port $LLM_PORT is not listening, establishing SSH tunnel to $LAN_LLM_HOST ..."\n\
#    ssh -f -N -L $LLM_PORT:localhost:$LLM_PORT enjo@$LAN_LLM_HOST\n\
#    echo "SSH tunnel is established."\n\
#else\n\
#    echo "Port $LLM_PORT is already listening."\n\
#fi' >> /etc/zsh/zshrc && \
    # Add default LLaMA model configuration for Continue extension.
#     mkdir /home/node/.continue && \
# echo 'name: Local Config\n\
# version: 1.0.0\n\
# schema: v1\n\
# models:\n\
#   - name: Local Qwen3-Coder\n\
#     provider: llama.cpp\n\
#     model: Qwen3-Coder\n\
#     apiBase: https://llm.enjo.tech\n\
#     apiKey: 5e9cc49a9126a4b85be7c41aafc62499fa56a873ac4a94eb5e8d532ae3d50a2a\n\
#     temperature: 0.4\n\
#     roles:\n\
#       - chat\n\
#       - edit\n\
#       - apply\n\
#     capabilities:\n\
#       - tool_use' > /home/node/.continue/config.yaml

# The tslint, typescript and eslint are installed in the base image.
#ARG NODE_MODULES="tslint-to-eslint-config typescript"
#RUN su node -c "umask 0002 && npm install -g ${NODE_MODULES}" \
#    && npm cache clean --force > /dev/null 2>&1

# Secure Shell : 22 (for SSH and remote container communication from VSCode)
# Docker daemon port : 2375 (for interactive from host)
# Frontend ports : 3000 3030 4173 5173 (3000 maybe occupied by VSCode, in this case use 3030 instead)
# Backend ports : 8080 8888
# Node.js remote debugging port : 9229 (enabled by : node --inspect=0.0.0.0:9229 app.js)
EXPOSE  22 2375 3000 3030 4173 5173 8080 8888 9229
USER    node

CMD ["/bin/zsh"]