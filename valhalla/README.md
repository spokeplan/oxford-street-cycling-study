# Valhalla

Image: `ghcr.io/gis-ops/docker-valhalla/valhalla` (Valhalla 3.5.1), pinned by digest in `run.ts` (`<image>` below).

`bun valhalla/run-all.ts` (or `bun run reproduce:valhalla`) runs `today`, `wigmore-track` and `full-closure` in turn: `run.ts`, then `bun scripts/run-trips.ts <scenario>` (results in `results/valhalla/<scenario>/`), then removes the container.

`bun valhalla/run.ts <scenario> <pbf>`:

- hard-links the PBF into `valhalla/custom_files-<scenario>/` (one PBF per dir; tiles are cached there and reused while the PBF hash is unchanged),
- removes the study's own containers (`valhalla-today`, `valhalla-wigmore-track`, `valhalla-full-closure` and `valhalla-<scenario>`; names in `valhalla/common.ts`), leaving any other container alone, then starts:

```
docker run -d --name valhalla-<scenario> -p 8002:8002 --ulimit nofile=65536:65536 \
  -v <repo>/valhalla/custom_files-<scenario>:/custom_files \
  -e server_threads=4 -e use_tiles_ignore_pbf=False -e force_rebuild=False \
  -e build_elevation=False -e build_admins=False -e build_time_zones=False \
  -e build_transit=False -e build_tar=True -e serve_tiles=True \
  <image>
```

- polls `http://localhost:8002/status` until ready.

The ulimit/server_threads caps are needed: with defaults (one worker per core, 24 here) the service died with `Too many open files (src/ipc_listener.cpp:297)` right after the build.
Stop with `docker rm -f valhalla-<scenario>`.
