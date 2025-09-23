# Adding New Hardware Checklist

> [!NOTE]
> Name the device using the format `<Manufacturer> <Device Name> <Revision>`.

> [!NOTE]
> Insert the hardware entry in all file mentioned below in alphabetical order.

- [ ] Update `.github/scripts/config/hardware.json` with the new device details.
- [ ] Update `.github/scripts/config/labels.json` with the new device details.
- [ ] Publish the labels to the project with `github_import_repo_issue_labels DeckSettings/game-reports-steamos .github/scripts/config/labels.json`
- [ ] Add the hardware option to `.github/scripts/config/game-report-validation.json` so reports get validated.
- [ ] Update `.github/ISSUE_TEMPLATE/GAME-REPORT.yml` to include the device.
- [ ] Upload the device images to the deck-verified-website source repository.
