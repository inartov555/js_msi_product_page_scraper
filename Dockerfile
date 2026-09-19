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

# scrape: CMD npm run scrape
# crawl: CMD npm run crawl -- --refresh false
# search: CMD npm run search 'A520M-A PRO'
# compare: CMD npm run compare -- "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
# serve: CMD npm run serve # if you need a scrapper service
# test: CMD npm run test # if you need to run tests to check whether project is working well

# CMD npm run compare -- "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
# CMD npm run search 'A520M-A PRO'
# CMD npm run crawl -- --refresh false
CMD ["bash", "-lc", "npm run ${SCRAPER_COMMAND:-test}"]
