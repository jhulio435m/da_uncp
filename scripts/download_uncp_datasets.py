#!/usr/bin/env python3
import csv
import json
import re
import time
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen


BASE = "https://www.datosabiertos.gob.pe"
SEARCH_URL = (
    BASE
    + "/SEARCH/type/dataset?query=uncp&sort_by=changed&sort_order=DESC"
)
OUT = Path("data")
RAW = OUT / "raw_pages"
DATASETS = OUT / "datasets"
MANIFEST_JSON = OUT / "uncp_manifest.json"
MANIFEST_CSV = OUT / "uncp_manifest.csv"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "Chrome/126 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
}


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self._stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self._stack.append({"tag": tag, "attrs": attrs, "text": []})

    def handle_data(self, data):
        if self._stack:
            self._stack[-1]["text"].append(data)

    def handle_endtag(self, tag):
        if not self._stack:
            return
        node = self._stack.pop()
        if node["tag"] == "a" and "href" in node["attrs"]:
            self.links.append(
                {
                    "href": node["attrs"].get("href", ""),
                    "text": " ".join("".join(node["text"]).split()),
                    "title": node["attrs"].get("title", ""),
                    "format": node["attrs"].get("data-format", ""),
                    "type": node["attrs"].get("type", ""),
                }
            )
        if self._stack:
            self._stack[-1]["text"].extend(node["text"])


class ResourceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.resource_id = ""
        self.links = []
        self._capture = None
        self._stack = []
        self._desc_depth = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "")
        self._stack.append({"tag": tag, "attrs": attrs, "text": []})
        if tag == "h1":
            self._capture = "title"
        if "field-name-body" in classes or "node-description" in classes:
            self._desc_depth = len(self._stack)
        if tag == "a" and "href" in attrs:
            self.links.append(
                {
                    "href": attrs.get("href", ""),
                    "text": "",
                    "title": attrs.get("title", ""),
                    "format": attrs.get("data-format", ""),
                    "type": attrs.get("type", ""),
                }
            )

    def handle_data(self, data):
        if not self._stack:
            return
        self._stack[-1]["text"].append(data)
        if self._capture == "title":
            self.title += data
        if self._desc_depth is not None:
            self.description += data

    def handle_endtag(self, tag):
        if not self._stack:
            return
        node = self._stack.pop()
        if node["tag"] == "a" and self.links:
            self.links[-1]["text"] = " ".join("".join(node["text"]).split())
        if tag == "h1":
            self._capture = None
        if self._desc_depth is not None and len(self._stack) < self._desc_depth:
            self._desc_depth = None
        if self._stack:
            self._stack[-1]["text"].extend(node["text"])


def slugify(value, max_len=90):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.lower()).strip("-")
    return (value or "item")[:max_len].strip("-")


def fetch(url, retries=3):
    last = None
    headers = dict(HEADERS)
    headers["Referer"] = BASE + "/"
    for attempt in range(retries):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=60) as res:
                return res.read(), dict(res.headers), res.geturl()
        except (HTTPError, URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1 + attempt)
    raise last


def save_text(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def page_url(index):
    if index == 0:
        return SEARCH_URL
    return SEARCH_URL + f"&page=0%2C{index}"


def extract_dataset_links(html):
    parser = LinkParser()
    parser.feed(html.decode("utf-8", errors="ignore"))
    links = []
    for link in parser.links:
        href = unquote(link["href"])
        if "/dataset/" not in href:
            continue
        absolute = urljoin(BASE, link["href"])
        if absolute not in links:
            links.append(absolute)
    return links


def extract_resource_candidates(html, dataset_url):
    parser = ResourceParser()
    text = html.decode("utf-8", errors="ignore")
    parser.feed(text)
    resource_ids = sorted(set(re.findall(r"resource_id=([a-f0-9-]{36})", text, re.I)))
    node_links = []
    file_links = []
    for link in parser.links:
        href = link["href"]
        if not href:
            continue
        absolute = urljoin(BASE, href)
        parsed = urlparse(absolute)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        label = " ".join([link.get("text", ""), link.get("title", ""), link.get("format", "")])
        if any(path.lower().endswith(ext) for ext in (".csv", ".xlsx", ".xls", ".docx", ".zip")):
            file_links.append((absolute, label))
        if "/node/" in path and path.rstrip("/").split("/")[-1].isdigit():
            node_links.append(absolute)
        if "resource_id" in query:
            for rid in query["resource_id"]:
                resource_ids.append(rid)
    return {
        "title": " ".join(parser.title.split()) or dataset_url.rsplit("/", 1)[-1],
        "description": " ".join(parser.description.split()),
        "resource_ids": sorted(set(resource_ids)),
        "node_links": sorted(set(node_links)),
        "file_links": file_links,
    }


def infer_ext(url, headers, fallback):
    path = unquote(urlparse(url).path)
    suffix = Path(path).suffix.lower()
    if suffix:
        return suffix
    content_type = headers.get("Content-Type", "").lower()
    if "spreadsheet" in content_type or "excel" in content_type:
        return ".xlsx"
    if "csv" in content_type:
        return ".csv"
    if "wordprocessingml" in content_type or "msword" in content_type:
        return ".docx"
    return fallback


def download_resource(url, target_base):
    content, headers, final_url = fetch(url)
    ext = infer_ext(final_url, headers, target_base.suffix or ".bin")
    target = target_base.with_suffix(ext)
    if target.exists() and target.read_bytes() == content:
        changed = False
    else:
        temporary = target.with_name(f".{target.name}.part")
        temporary.write_bytes(content)
        temporary.replace(target)
        changed = True
    return target, len(content), headers.get("Content-Type", ""), final_url, changed


def dataset_directory(dataset_slug, dataset_index):
    existing = sorted(DATASETS.glob(f"*-{dataset_slug}"))
    return existing[0] if existing else DATASETS / f"{dataset_index:02d}-{dataset_slug}"


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    DATASETS.mkdir(parents=True, exist_ok=True)

    all_dataset_urls = []
    for index in range(20):
        url = page_url(index)
        content, _, _ = fetch(url)
        save_text(RAW / f"search_page_{index + 1}.html", content)
        links = extract_dataset_links(content)
        if not links:
            break
        for link in links:
            if link not in all_dataset_urls:
                all_dataset_urls.append(link)
        if index > 0 and len(links) == 0:
            break

    manifest = []
    seen_resources = set()
    for dataset_index, dataset_url in enumerate(all_dataset_urls, start=1):
        dataset_slug = slugify(dataset_url.rsplit("/", 1)[-1])
        dataset_dir = dataset_directory(dataset_slug, dataset_index)
        dataset_dir.mkdir(parents=True, exist_ok=True)
        html, _, _ = fetch(dataset_url)
        save_text(RAW / f"dataset_{dataset_index:02d}_{dataset_slug}.html", html)
        info = extract_resource_candidates(html, dataset_url)

        candidates = []
        for file_url, label in info["file_links"]:
            candidates.append({"url": file_url, "label": label, "source": "file_link"})

        for node_url in info["node_links"]:
            try:
                node_html, _, _ = fetch(node_url)
            except Exception as exc:
                candidates.append(
                    {"url": node_url, "label": f"node_fetch_error: {exc}", "source": "node"}
                )
                continue
            node_slug = slugify(node_url.rstrip("/").rsplit("/", 1)[-1])
            save_text(RAW / f"resource_node_{node_slug}.html", node_html)
            node_info = extract_resource_candidates(node_html, node_url)
            for file_url, label in node_info["file_links"]:
                candidates.append({"url": file_url, "label": label, "source": "node_file_link"})
            for rid in node_info["resource_ids"]:
                api_url = BASE + f"/api/action/datastore/search.json?resource_id={rid}&limit=50000"
                candidates.append({"url": api_url, "label": rid, "source": "datastore_api"})

        for rid in info["resource_ids"]:
            api_url = BASE + f"/api/action/datastore/search.json?resource_id={rid}&limit=50000"
            candidates.append({"url": api_url, "label": rid, "source": "datastore_api"})

        if not candidates:
            manifest.append(
                {
                    "dataset_title": info["title"],
                    "dataset_url": dataset_url,
                    "description": info["description"],
                    "resource_url": "",
                    "resource_label": "NO_RESOURCE_FOUND",
                    "resource_source": "",
                    "local_path": "",
                    "bytes": 0,
                    "content_type": "",
                    "status": "missing",
                }
            )
            continue

        for resource_index, candidate in enumerate(candidates, start=1):
            resource_url = candidate["url"]
            if resource_url in seen_resources:
                continue
            seen_resources.add(resource_url)
            target_base = dataset_dir / f"{resource_index:02d}-{slugify(candidate['label'], 60)}"
            try:
                target, size, content_type, final_url, changed = download_resource(
                    resource_url, target_base
                )
                status = "downloaded" if changed else "unchanged"
                local_path = str(target)
            except Exception as exc:
                size = 0
                content_type = ""
                final_url = resource_url
                status = f"error: {exc}"
                local_path = ""
            manifest.append(
                {
                    "dataset_title": info["title"],
                    "dataset_url": dataset_url,
                    "description": info["description"],
                    "resource_url": resource_url,
                    "final_url": final_url,
                    "resource_label": candidate["label"],
                    "resource_source": candidate["source"],
                    "local_path": local_path,
                    "bytes": size,
                    "content_type": content_type,
                    "status": status,
                }
            )
            time.sleep(0.2)

    MANIFEST_JSON.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    with MANIFEST_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=manifest[0].keys() if manifest else [])
        if manifest:
            writer.writeheader()
            writer.writerows(manifest)

    print(f"datasets={len(all_dataset_urls)} resources={len(manifest)}")
    print(f"manifest={MANIFEST_JSON}")


if __name__ == "__main__":
    main()
