FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /scraper

# Copying package files first for caching
COPY package*.json ./

# Install Node dependencies first for better caching
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy the scraper
COPY . .

USER root

# Ensure non-root user (provided by the Playwright base image) owns the workspace
RUN chown -R pwuser:pwuser /scraper
USER pwuser

# Default behavior: run the scraper suite (with a virtual display)
# CMD bash -lc "npm run scraper --headed $SCRAPER_GREP"
CMD ["npm", "run", "scraper"]
