import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Field, Select } from "../../components/ui/primitives";
import uiStyles from "../../components/ui/ui.module.css";
import styles from "./photo-capture.module.css";
import { browserOffset, localDateTimeToRFC3339, readPhotoMetadata } from "./photo-metadata";
import { useI18n } from "../../components/ui/display-settings";
import { workflowLabel } from "../workspace/workflow-labels";

type Place = { name: string; address: string; latitude: number; longitude: number };
export function PhotoCaptureFields({ positions, initialPosition }: { positions: string[]; initialPosition?: string }) {
  const { t } = useI18n();
  const prefix = useId().replace(/:/g, "");
  const [file, setFile] = useState<File>();
  const [inputMode, setInputMode] = useState<"camera" | "library">("camera");
  const [preview, setPreview] = useState("");
  const [captured, setCaptured] = useState("");
  const [offset, setOffset] = useState(browserOffset());
  const [capturedSource, setCapturedSource] = useState("manual");
  const [candidate, setCandidate] = useState<Place>();
  const [place, setPlace] = useState<Place>();
  const [locationSource, setLocationSource] = useState("");
  const [mapRequested, setMapRequested] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const cache = useRef(new Map<string, Place[]>());
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = window.setTimeout(async () => {
      const key = query.trim();
      const cached = cache.current.get(key);
      if (cached) { setResults(cached); return; }
      setSearching(true); setSearchError("");
      try {
        const response = await fetch(`/api/location-search?q=${encodeURIComponent(key)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "撮影場所を検索できませんでした。");
        cache.current.set(key, body.data);
        setResults(body.data);
      } catch (error) { setSearchError(error instanceof Error ? error.message : "撮影場所を検索できませんでした。"); }
      finally { setSearching(false); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [query]);
  async function chooseFile(next?: File) {
    setFile(next); setCandidate(undefined); setPlace(undefined); setLocationSource(""); setMapRequested(false); setMapError(false);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next ? URL.createObjectURL(next) : "");
    if (!next) return;
    const metadata = await readPhotoMetadata(next);
    if (metadata.capturedLocal) { setCaptured(metadata.capturedLocal); setCapturedSource("metadata"); }
    else if (inputMode === "camera") {
      const now = new Date();
      setCaptured(new Date(now.valueOf() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19));
      setCapturedSource("device");
    } else { setCaptured(""); setCapturedSource("manual"); }
    setOffset(metadata.offset ?? browserOffset());
    if (metadata.latitude !== undefined && metadata.longitude !== undefined) {
      setCandidate({ name: t("workflow.exifLocation"), address: t("workflow.checkLocation"), latitude: metadata.latitude, longitude: metadata.longitude });
      setLocationSource("metadata");
    }
  }
  function currentLocation() {
    setSearchError("");
    if (!navigator.geolocation) { setSearchError("この端末では現在位置を取得できません。"); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setCandidate({ name: t("workflow.sourceDevice"), address: t("workflow.confirmLocation"), latitude: coords.latitude, longitude: coords.longitude }); setPlace(undefined); setLocationSource("device"); setMapRequested(false); setMapError(false); },
      () => setSearchError("現在位置を取得できませんでした。地図検索は引き続き利用できます。"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }
  const rfc3339 = localDateTimeToRFC3339(captured, offset);
  return <>
    <Field id={`${prefix}-position`} label={t("workflow.photoPosition")}>
      <Select id={`${prefix}-position`} name="position" defaultValue={initialPosition ?? positions[0]} required>
        {positions.map(position => <option key={position} value={position}>{workflowLabel(t, position)}</option>)}
      </Select>
    </Field>
    <div className={uiStyles["ui-actions"]}>
      <Button type="button" variant={inputMode === "camera" ? "primary" : "secondary"} onClick={() => { setInputMode("camera"); void chooseFile(); }}>{t("workflow.takePhoto")}</Button>
      <Button type="button" variant={inputMode === "library" ? "primary" : "secondary"} onClick={() => { setInputMode("library"); void chooseFile(); }}>{t("workflow.choosePhoto")}</Button>
    </div>
    <Field id={`${prefix}-photo`} label={t("workflow.originalPhoto")} hint={t("workflow.photoFileHint")}>
      <input key={inputMode} id={`${prefix}-photo`} className={uiStyles["ui-input"]} name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture={inputMode === "camera" ? "environment" : undefined} required onChange={event => void chooseFile(event.currentTarget.files?.[0])} />
    </Field>
    {file && <div className={styles.preview}><img src={preview} alt={t("workflow.photoPreviewAlt")} /><span>{file.name}</span></div>}
    <Field id={`${prefix}-captured`} label={t("workflow.captureDate")}>
      <input id={`${prefix}-captured`} className={uiStyles["ui-input"]} type="datetime-local" step="1" value={captured} required onChange={event => { setCaptured(event.currentTarget.value); setCapturedSource("manual"); }} />
    </Field>
    <Field id={`${prefix}-offset`} label={t("workflow.captureOffset")} hint={t("workflow.captureOffsetHint")}>
      <input id={`${prefix}-offset`} className={uiStyles["ui-input"]} value={offset} pattern="[+-][0-9]{2}:[0-9]{2}" required onChange={event => { setOffset(event.currentTarget.value); setCapturedSource("manual"); }} />
    </Field>
    <input type="hidden" name="device_captured_at" value={rfc3339} />
    <input type="hidden" name="captured_at_source" value={capturedSource} />
    <p className={styles.source}>{t("workflow.sourcePrefix", { source: t(capturedSource === "metadata" ? "workflow.sourceMetadata" : capturedSource === "device" ? "workflow.takePhoto" : "workflow.sourceManual") })}</p>
    <Field id={`${prefix}-location`} label={t("workflow.location")} hint={t("workflow.locationHint")}>
      <input id={`${prefix}-location`} className={uiStyles["ui-input"]} value={query} placeholder={t("workflow.locationPlaceholder")} onChange={event => { const value = event.currentTarget.value; setQuery(value); if (value.trim().length < 2) setResults([]); }} />
    </Field>
    <div><Button type="button" variant="secondary" onClick={currentLocation}>{t("workflow.getCurrentLocation")}</Button></div>
    {searching && <p role="status">{t("workflow.searching")}</p>}
    {searchError && <Alert tone="danger">{searchError}</Alert>}
    {!!results.length && <ul className={styles.locationResults}>{results.map(result => <li key={`${result.latitude},${result.longitude}`}><Button type="button" variant="secondary" className={`${uiStyles["ui-button"]} ${uiStyles["ui-button--secondary"]} ${styles.locationResult}`} onClick={() => { setCandidate(result); setPlace(undefined); setLocationSource("search"); setMapRequested(false); setMapError(false); }}>{result.name}<br />{result.address}</Button></li>)}</ul>}
    {candidate && <div className={styles.preview}>
      <strong>{candidate.name}</strong><span>{candidate.address}</span>
      {!mapRequested && <Button type="button" variant="secondary" onClick={() => setMapRequested(true)}>{t("workflow.viewLocationMap")}</Button>}
      {mapRequested && <><img className={styles.map} src={`/api/location-search?map=1&lat=${candidate.latitude}&lon=${candidate.longitude}`} alt={`${candidate.name}の地図上の位置`} onError={() => setMapError(true)} />
        <small><a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Powered by Geoapify</a> / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> / <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a></small></>}
      {mapError && <Alert tone="danger">{t("workflow.mapError")}</Alert>}
      <p className={styles.source}>{t("workflow.sourcePrefix", { source: t(locationSource === "metadata" ? "workflow.sourceMetadata" : locationSource === "device" ? "workflow.sourceDevice" : "workflow.sourceSearch") })}</p>
      {mapRequested && !mapError && <Button type="button" onClick={() => setPlace(candidate)}>{t("workflow.confirmLocationButton")}</Button>}
    </div>}
    <Field id={`${prefix}-confirmed-location`} label={t("workflow.confirmedLocation")}>
      <input id={`${prefix}-confirmed-location`} className={uiStyles["ui-input"]} name="location_label" value={place ? [place.name, place.address].filter(Boolean).join(" / ") : ""} readOnly required placeholder={t("workflow.selectLocation")} />
    </Field>
    <input type="hidden" name="location_source" value={locationSource} />
    <input type="hidden" name="latitude" value={place?.latitude ?? ""} />
    <input type="hidden" name="longitude" value={place?.longitude ?? ""} />
  </>;
}
