project ?= grow-prod
version ?= auto

deploy:
	gcloud app deploy \
	  -q \
	  --project=$(project) \
	  --version=$(version) \
	  --verbosity=error \
	  --promote \
	  app.yaml

run-gae:
	dev_appserver.py --allow_skipped_files=true .
