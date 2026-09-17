FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /tests

# Copying package files first for caching
COPY package*.json ./

# Install Node dependencies first for better caching
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy the tests
COPY . .

# Install Playwright browsers & system deps
RUN npx playwright install --with-deps

USER root

# Ensure non-root user (provided by the Playwright base image) owns the workspace
RUN chown -R pwuser:pwuser /tests
USER pwuser

# Default behavior: run the tests suite (with a virtual display)
CMD bash -lc "npx playwright test --headed $TEST_GREP"
