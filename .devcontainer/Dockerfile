# Name this image to "reg.enjo.tech/dev-container/vsc-tsnode:22-bookworm-amd64".
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install OS level packages as needed.
ARG USER="node"
RUN export DEBIAN_FRONTEND=noninteractive && \
    # Add Java 21 repository which is required for SonarLint extension.
    apt update && apt-get install -y --no-install-recommends gnupg software-properties-common wget && \
    wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /usr/share/keyrings/adoptium.gpg > /dev/null && \
    echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" | tee /etc/apt/sources.list.d/adoptium.list && \
    apt update && apt upgrade -y && apt-get install -y --no-install-recommends \
        curl git git-lfs htop iftop net-tools netcat-traditional nfs-common nmap rsync traceroute vim \
        dnsutils exfatprogs iputils-ping openssh-server telnet temurin-21-jdk && \
    # Clean up packages and repositories.
    apt-get autoclean && apt-get autoremove && rm -rf /var/lib/apt/lists/* && \
    # Install oh-my-bash for root and node user, disable auto update and change theme to 'lambda'.
    bash -c "$(curl -fsSL https://raw.githubusercontent.com/ohmybash/oh-my-bash/master/tools/install.sh)" --unattended && \
    sed -i 's/^# DISABLE_AUTO_UPDATE/DISABLE_AUTO_UPDATE/' ~/.bashrc && \
    sed -i 's/OSH_THEME="font"/OSH_THEME="lambda"/g' ~/.bashrc && rm ~/.bashrc.omb-* && \
    mkdir -p ~/.oh-my-bash/custom/themes/lambda && cp -r ~/.bashrc ~/.oh-my-bash /home/${USER}/ && \
    sed -i "s/\/root\//\/home\/${USER}\//g" /home/${USER}/.bashrc && chown -R ${USER}:${USER} /home/${USER} && \
    rm -rf ~/.oh-my-bash/custom/themes/lambda && \
    ln -s /home/${USER}/.oh-my-bash/custom/themes/lambda ~/.oh-my-bash/custom/themes/lambda

# Make default shell to zsh which is installed in the base image.
ARG DEF_SHELL="/bin/zsh"
# Define the local deployed LLM server.
ARG LLM_HOST="llm.enjo.tech"
ARG LLM_PORT=443
ARG PNPM_VERSION="10.28.2"
# Make Node.js default to version 22.
ENV NODE_VERSION=22
RUN \
    # Install the specific version of node.js.
    su node -c ". /usr/local/share/nvm/nvm.sh && nvm install --default ${NODE_VERSION} && nvm use default" && \
    # Install pnpm and opencode TUI.
    npm install -g pnpm@$PNPM_VERSION opencode-ai && \
    # Install corepack.
    corepack enable && corepack use pnpm@$PNPM_VERSION
    # Change default shell from bash to zsh for the root and node users only.
    #sed -i -E "s|^(root:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:).*|\1$DEF_SHELL|" /etc/passwd && \
    #sed -i -E "s|^(node:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:).*|\1$DEF_SHELL|" /etc/passwd && \

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
RUN mkdir -p /home/${USER}/.continue && \
echo "name: Local Config\n\
version: 1.0.0\n\
schema: v1\n\
models:\n\
  - name: Local Qwen3-Coder\n\
    provider: llama.cpp\n\
    model: Qwen3-Coder\n\
    apiBase: https://$LLM_HOST\n\
    apiKey: 5e9cc49a9126a4b85be7c41aafc62499fa56a873ac4a94eb5e8d532ae3d50a2a\n\
    temperature: 0.6\n\
    roles:\n\
      - chat\n\
      - edit\n\
      - apply\n\
    capabilities:\n\
      - tool_use\n\
  - name: Local Qwen3-Completer\n\
    provider: llama.cpp\n\
    model: Qwen3-Completer\n\
    apiBase: https://$LLM_HOST:333\n\
    apiKey: 93fd7e5b3608bc614daf197be0a5082dc22efa4a8fe3eec9eeea38b03c17d79c\n\
    temperature: 0.2\n\
    roles:\n\
      - autocomplete\n\
    capabilities:\n\
      - code_completion" > /home/${USER}/.continue/config.yaml && chown -R ${USER}:${USER} /home/${USER}/.continue && \
    # Add default LLaMA model configuration for OpenCode.
    mkdir -p /home/${USER}/.config/opencode && \
echo '{\n\
  "$schema": "https://opencode.ai/config.json",\n\
  "provider": {\n\
    "llamacpp": {\n\
      "npm": "@ai-sdk/openai-compatible",\n\
      "name": "Local llama.cpp",\n\
      "options": {\n\
        "baseURL": "https://llm.enjo.tech/v1",\n\
        "apiKey": "5e9cc49a9126a4b85be7c41aafc62499fa56a873ac4a94eb5e8d532ae3d50a2a"\n\
      },\n\
      "models": {\n\
        "qwen3-coder": {\n\
          "name": "Local Qwen3-Coder"\n\
        }\n\
      }\n\
    }\n\
  },\n\
  "model": "llamacpp/qwen3-coder"\n\
}' > /home/${USER}/.config/opencode/opencode.json && chown -R ${USER}:${USER} /home/${USER}/.config

# The tslint, typescript and eslint are installed in the base image.
#ARG NODE_MODULES="tslint-to-eslint-config typescript"
#RUN su node -c "umask 0002 && npm install -g ${NODE_MODULES}" \
#    && npm cache clean --force > /dev/null 2>&1

# Secure Shell : 22 (for SSH and remote container communication from VSCode)
# Docker daemon port : 2375 (for interactive from host)
# Frontend ports : 3000 3030 4173 5173 (3000 maybe occupied by VSCode, in this case use 3030 instead)
# Backend ports : 8080 8888
# Node.js remote debugging port : 9229 (enabled by : node --inspect=0.0.0.0:9229 app.js)
# Vitest UI port : 9999
EXPOSE  2375 3000 3030 4173 5173 8080 8888 9229 9999

USER    ${USER}
WORKDIR /home/${USER}

CMD ["/bin/zsh"]