# Meetup Now API

This repository contains the **API code** for Meetup Now. There is also a [Meetup Now App](https://github.com/meetup/now-mobile) and [Meetup Now Admin](https://github.com/meetup/now-admin).

This README covers: 
1. [Installation](https://github.com/meetup/now-api#installation)
1. [Usage](https://github.com/meetup/now-api#usage)
1. [Testing](https://github.com/meetup/now-api#testing)
1. [Contributing](https://github.com/meetup/now-api#contributing)


## Installation

### Installing dependencies

1. Install [yarn](https://yarnpkg.com/en/docs/install#mac-stable).
1. Install API dependencies: `cd now-api; yarn`. 
1. Install [asdf](https://github.com/asdf-vm/asdf).
1. Install the [asdf node plugin](https://github.com/asdf-vm/asdf-nodejs).

> **NOTE:** if command asdf is not found you likely need to source your `.bash_profile` or `.zshrc`.

> **NOTE:** make sure the appropdiate version of node is running: `node -v` should return something like v8.9.4. If it doesn't, run `asdf install` to install the version specified in `.tool-versions`. 

### Setting up Postgres

_**On MacOS**_

On MacOS, `postgres` will be installed as a dependency of `postgis`, so installing that should be sufficient.

- `brew install postgis`
- `brew services start postgresql`
- `echo 'export PATH="/usr/local/opt/postgresql/bin:$PATH"' >> ~/.bash_profile`
- `createdb meetup_now`
- `createdb meetup_now_test`

_**On Ubuntu**_
- `sudo apt install postgres`
- `sudo -u postgres -i`
  - `createuser YOUR_USER_ID`
  - `createdb meetup_now`
  - `createdb meetup_now_test`
  - `psql`
    - `GRANT ALL ON DATABASE meetup_now to YOUR_USER_ID`
    - `GRANT ALL ON DATABASE meetup_now_test to YOUR_USER_ID`

_**On MacOS and Ubuntu**_
- `yarn migrate:test`
- `yarn migrate:development`

> **NOTE:** If you get mysterious messages about postgis when you try to run migrations, there's a troubleshooting guide [here]().

### Setting up admin

If you install [Meetup Now Admin](https://github.com/meetup/now-admin) in the same directory and build it it will serve at http://localhost:3000/admin

```
|-now-api
| \-(yarn server)
|-now-admin
| \-dist
```

## Usage

### Running the API

> **NOTE:** To run the API, you'll need to have a valid `star.dev.meetup.com.key` and `star.dev.meetup.com.crt` credentials in your `~/.certs/` folder. If you've developed on mup-web, you probably already have these. If you need to get them, follow step 3 of the instructions [here](https://meetup.atlassian.net/wiki/spaces/WEG/pages/237732138/Setup+for+Meetup+Web+Platform+mup-web+pro-web+development), under the section entititled _Setting up for *-web development_.

- `yarn build`
- `yarn server`

The API is now running at `https://*.dev.meetup.com`, where you can use any `.dev.meetup.com` URL that you have mapped to localhost in your `/etc/hosts`.

If you installed admin, it is now running at http://localhost:3000/admin.

### Connecting to the API from a device

If you want to build the [Meetup Now app](https://github.com/meetup/now-mobile/blob/master/README.md#usage) and have it connect to the API you are running locally, simply modify the `.env` file in the `meetup-now` directory: 

```
# Replace these:
#NOW_API_URL=https://now.meetup.com/graphql
#NOW_WS_URL=wss://now.meetup.com/subscriptions
# With these:
NOW_API_URL=http://localhost:3000/graphql
NOW_WS_URL=wss://localhost:3000/subscriptions
```

> **BEWARE: gradle keeps a build cache.** If you change your `.env` file you need to `cd /android` and `./gradlew clean` before you run `yarn android` or changes wont be picked up.

> **BEWARE: AVDs are virtual machines.** To target an API running on your local machine you need to handle port forwarding: `adb reverse tcp:3000 tcp:3000`.

### Deploying

Deployments are handled by travis via `bin/deploy.sh`

## Testing

To run ESLint, Jest, and Flow:

`yarn test`

A common cause of seemingly unrelated test failures is a stale db schema. Make sure you have the latest with `yarn migrate:development`.

## Contributing

1. PRs MUST be code reviewed.
1. PRs SHOULD include test coverage.
1. PRs SHOULD be rebased against master if there are upstream changes.
