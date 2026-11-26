package com.shinjin.pop.admin;

import com.shinjin.pop.history.PreloginSettings;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static com.shinjin.pop.admin.EquipmentSettingsController.*;
import static com.shinjin.pop.admin.EquipmentSettingsFixture.Item;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/prelogin-details/{terminalId}/group")
public final class PreloginGroupController {
    private final PreloginDetailStore store;
    private final PreloginSiteScope sites;
    private final PreloginSettings settings;
    private final LocalSettingsReference master;
    private final EquipmentSettingsController equipment;
    public PreloginGroupController(PreloginDetailStore store, PreloginSiteScope sites, PreloginSettings settings,
                                   LocalSettingsReference master, EquipmentSettingsController equipment) {
        this.store = store;
        this.sites = sites;
        this.settings = settings;
        this.master = master;
        this.equipment = equipment;
    }

    public record Command(String scopePlant, String scopeCenter, Long siteRevision, Long expectedVersion, String number, String side, List<Step> steps) {}
    private record Read(View view, PreloginGroupState state) {}

    private static View view(EquipmentSettingsFixture.Site site, long siteVersion, long version, PreloginGroupState state,
                             List<Item> processes, List<Item> warehouses) {
        var empty = new LocalSettings(List.of(), null, "");
        return new View(site, List.of(), List.of(), Map.of(), version, true, false, true, List.of(), state.groups(),
                processes, warehouses, new LocalSettings(List.of(), state.assignment(), ""), empty, siteVersion);
    }

    private Read read(String id, HttpServletRequest req) {
        long siteVersion = store.localVersion(id, "", "", "plant", req);
        var flags = settings.effective(id, req);
        if (flags.missing().contains("plant")) throw new ResponseStatusException(HttpStatus.CONFLICT, "PLANT_REQUIRED");
        var site = sites.site(id, req);
        if (!Set.of("005", "105").contains(site.center())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "GROUP_CENTER_REQUIRED");
        if (flags.missing().contains("process")) throw new ResponseStatusException(HttpStatus.CONFLICT, "PROCESS_REQUIRED");
        String plant = site.plant(), center = site.center();
        long version = store.localVersion(id, plant, center, "group", req);
        var state = PreloginGroupState.read(store, id, plant, center, req)
                .orElseGet(() -> equipment.groupRegistryCopy(id, plant));
        var processes = master.groupProcessesFor(id, plant, center)
                .map(rows -> rows.stream().map(r -> new Item(r.code(), r.name())).toList()).orElse(EquipmentSettingsFixture.PROCESSES);
        var warehouses = master.warehousesFor(id, plant, center)
                .map(rows -> rows.stream().map(r -> new Item(r.code(), r.name())).toList()).orElse(EquipmentSettingsFixture.WAREHOUSES);
        var displaySite = new EquipmentSettingsFixture.Site(plant, site.plantName(), center, site.centerName(), "");
        return new Read(view(displaySite, siteVersion, version, state, processes, warehouses), state);
    }

    @GetMapping
    public ResponseEntity<View> list(@PathVariable String terminalId, HttpServletRequest req, HttpServletResponse res) {
        var read = read(terminalId, req);
        store.browser(req, res, true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(read.view());
    }

    @PutMapping(value="/{operation:add|remove|processes|assign}", consumes="application/json")
    public ResponseEntity<View> change(@PathVariable String terminalId, @PathVariable String operation,
                                            @RequestBody Command cmd, HttpServletRequest req, HttpServletResponse res) {
        var current = read(terminalId, req);
        var view = current.view();
        if (!Objects.equals(view.siteRevision(), cmd.siteRevision()) || !view.site().plant().equals(cmd.scopePlant()) || !view.site().center().equals(cmd.scopeCenter()))
            throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SITE_CHANGED");
        if (cmd.expectedVersion() == null || cmd.expectedVersion() < 0)
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "VERSION_REQUIRED");
        if (view.version() != cmd.expectedVersion()) return stale(view);
        var next = current.state().change(operation, terminalId, cmd.number(), cmd.side(), cmd.steps(), view.processes(), view.warehouses());
        try {
            long version = store.saveLocal(terminalId, cmd.scopePlant(), cmd.scopeCenter(), "group", cmd.expectedVersion(), next, req, res, cmd.siteRevision());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(view(view.site(), view.siteRevision(), version, next, view.processes(), view.warehouses()));
        } catch (ResponseStatusException error) {
            if (!"STALE_SETTINGS".equals(error.getReason())) throw error;
            return stale(read(terminalId, req).view());
        }
    }
    private static ResponseEntity<View> stale(View view) {
        return ResponseEntity.status(HttpStatus.CONFLICT).cacheControl(CacheControl.noStore()).body(view);
    }
}
