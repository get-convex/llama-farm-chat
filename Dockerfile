FROM ollama/ollama:latest

# Copy the current directory contents into the container at /app

ARG WORKER_API_KEY
ENV WORKER_API_KEY=$WORKER_API_KEY
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

ENV NODE_VERSION=18.17.0
ENV NVM_DIR /tmp/nvm
WORKDIR $NVM_DIR
RUN apt install -y curl && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION} && \
    . "$NVM_DIR/nvm.sh" && nvm use ${NODE_VERSION}
ENV PATH="${NVM_DIR}/versions/node/v${NODE_VERSION}/bin/:${PATH}"
RUN node --version && npm --version

# # Clean install of npm
WORKDIR /app
COPY package.json package-lock.json tsconfig.json /app/
RUN npm ci
ADD convex ./convex
ADD shared ./shared
ADD worker ./worker

ENTRYPOINT [ ]
# ENTRY [ "npm", "run", "worker"]
