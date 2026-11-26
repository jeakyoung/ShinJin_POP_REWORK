package com.shinjin.pop.admin;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/admin/terminal-settings/{terminalId}")
public class TerminalSettingsDemoController {
    private static final String APPLIED = TerminalSettingsDemoController.class.getName() + ".applied";
    private static final Set<String> ROLES = Set.of("document", "shipment", "label");
    private static final Map<String, String> DEMO_ADMINISTRATORS = Map.of(
            "DEMO-A", "DEMO-W01", "DEMO-B", "DEMO-W03", "DEMO-A2", "DEMO-W04");

    public static String administratorId(String terminalId) {
        return DEMO_ADMINISTRATORS.get(terminalId);
    }

    public record LotPolicy(String issueWarehouse, String returnWarehouse, String returnLocation) {
        public boolean allowsIssue(String warehouse) {
            return issueWarehouse == null || issueWarehouse.equals(warehouse);
        }
    }

    private final EquipmentSettingsController equipment;
    private final PreloginDetailStore local;

    private final WarehouseSettings warehouse = new WarehouseSettings();
    private final java.util.Optional<WarehouseSettingsTestAdapter> warehouseAdapter;

    public TerminalSettingsDemoController(EquipmentSettingsController equipment, java.util.Optional<WarehouseSettingsTestAdapter> warehouseAdapter,PreloginDetailStore local) {
        this.equipment = equipment;
        this.warehouseAdapter = warehouseAdapter;
        this.local=local;
    }
    private static WarehouseSettings.Scope warehouseScope(Access access) {
        return new WarehouseSettings.Scope(access.scope.factory, access.scope.terminal);
    }
    private WarehouseSettings.Area area(Access access, HttpServletRequest request) {
        var site = equipment.read(access.scope.terminal, request).getBody().site();
        if (site == null || site.plant().isBlank()) throw WarehouseSettings.failure(org.springframework.http.HttpStatus.CONFLICT, "PLANT_REQUIRED");
        return new WarehouseSettings.Area(access.scope.factory, site.plant(), site.center());
    }
    private WarehouseSettingsTestAdapter testAdapter() {
        return warehouseAdapter.orElseThrow(() -> WarehouseSettings.failure(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE"));
    }

    private List<WarehouseSettings.Row> warehouseRows(Access access, WarehouseSettings.Area area) {
        if (access.reference() == null) return testAdapter().rows(area);
        var source = access.reference();
        return source.warehouses().stream().map(row -> new WarehouseSettings.Row(
                row.code(), row.name(), row.idx(), source.warehousePlantName() == null ? source.plantName() : source.warehousePlantName())).toList();
    }

    @PostMapping("/warehouse/entry")
    public synchronized ResponseEntity<WarehouseSettings.View> warehouseEntry(@PathVariable String terminalId,
            @RequestBody WarehouseSettings.Challenge challenge, HttpServletRequest request) {
        var actor = DemoSessionController.requireIdentity(request);
        var access = access(terminalId, actor);
        if (access == null) return ResponseEntity.status(403).build();
        var area = area(access, request);
        warehouse.resetEntry(request.getSession(false));
        var adapter = testAdapter();
        adapter.verify(challenge.password());
        var result = warehouse.open(request.getSession(false), warehouseScope(access), area, actor.worker().id(), access.canEdit,
                current(access).version(), warehouseRows(access, area));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }

    @PostMapping("/warehouse/close")
    public synchronized ResponseEntity<Void> closeWarehouse(@PathVariable String terminalId, @RequestBody WarehouseSettings.Command command,
            HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null) return ResponseEntity.status(403).build();
        warehouse.close(request.getSession(false), warehouseScope(access), command.entry());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/warehouse/{step:selection|priority}")
    public synchronized ResponseEntity<WarehouseSettings.View> saveWarehouse(@PathVariable String terminalId, @PathVariable String step,
            @RequestBody WarehouseSettings.Command command, HttpServletRequest request) {
        var actor = DemoSessionController.requireIdentity(request);
        var access = access(terminalId, actor);
        if (access == null || !access.canEdit) return ResponseEntity.status(403).build();
        var area = area(access, request);
        var old = current(access);
        var result = warehouse.write(request.getSession(false), warehouseScope(access), area, actor.worker().id(), step, command,
                old.version(), warehouseRows(access, area));
        saved.put(access.scope, new Configuration(result.version(), old.values()));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }

    public synchronized DemoSessionController.Identity pinAtLogin(DemoSessionController.Identity identity, HttpServletRequest request) {
        var access = access(identity.terminal().id(), identity);
        if (access != null) {
            applied(access, request, withLocalPrinters(access,request), true);
            warehouse.pin(warehouseScope(access), request.getSession(false));
            return equipment.withWorkNames(equipment.pin(identity, request),access.catalog().processNames(),request);
        }
        return identity;
    }

    public synchronized java.util.Optional<java.util.Map<String,java.util.List<String>>> pinnedWarehouseRoles(HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        return PreloginSessionValues.warehouseRoles(request).or(() -> warehouse.pinnedRoles(request.getSession(false)));
    }

    public synchronized LotPolicy lotPolicy(DemoSessionController.Identity identity, HttpServletRequest request) {
        var access = access(identity.terminal().id(), identity);
        if (access == null) throw new IllegalStateException("Missing demo terminal settings");
        String id = access.scope().terminal();
        String warehouse = applied(access, request, current(access), false).values().warehouse();
        if (warehouse.isEmpty()) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.CONFLICT, "WAREHOUSE_REQUIRED");
        // Stock and locations here belong to the isolated work-order fixture.
        boolean alternate = access.reference() == null && access.catalog().warehouses().size() > 1
                && warehouse.equals(access.catalog().warehouses().get(1));
        return switch (id) {
            case "DEMO-A" -> alternate ? new LotPolicy("WH-A2", "WH-RETURN-A2", "RET-02")
                    : new LotPolicy(null, "WH-RETURN-A", "RET-01");
            case "DEMO-B" -> alternate ? new LotPolicy("WH-B", "WH-RETURN-B", "RET-02")
                    : new LotPolicy(null, "WH-RETURN-B", "RET-01");
            default -> new LotPolicy(null, "WH-RETURN-A2", "RET-01");
        };
    }

    public synchronized Values appliedValues(DemoSessionController.Identity identity, HttpServletRequest request) {
        var access = access(identity.terminal().id(), identity);
        if (access == null) throw new IllegalStateException("Missing demo terminal settings");
        return PreloginSessionValues.applyMaterials(applied(access, request, current(access), false).values(), request);
    }

    public record Output(String id, String role) {}
    public record Catalog(List<String> processes, List<String> warehouses, List<Output> outputs, List<String> printers, List<MaterialSettingsFixture.Quality> materials, Map<String,String> processNames, Map<String,Integer> processIndices) {}
    public record Values(String process, String warehouse, Map<String, String> outputs, List<String> materials) {}
    public record Configuration(long version, Values values) {}
    public record Update(Long expectedVersion, Values values,Long printerVersion) {}
    public record View(String terminalId, boolean canEdit, Catalog catalog,
                       Configuration saved, Configuration applied, boolean warehouseConfigured, EquipmentSettingsController.ProcessSelection processSelection,long printerVersion) {}
    public record Reply(String code, View view) {}
    private record Scope(String factory, String terminal) {}
    private record SessionSettings(Scope scope, Configuration configuration) {}
    private record Access(Scope scope, Catalog catalog, boolean canEdit, LocalSettingsReference.Snapshot reference) {}

    private final Map<Scope, Configuration> saved = new HashMap<>();

    @GetMapping
    public synchronized ResponseEntity<Reply> read(@PathVariable("terminalId") String terminalId, HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null) return reply(403, "TERMINAL_SCOPE", null);
        return result(200, "OK", access, request, false);
    }

    @PutMapping
    public synchronized ResponseEntity<Reply> save(@PathVariable("terminalId") String terminalId,
                                                     @RequestBody Update update, HttpServletRequest request,jakarta.servlet.http.HttpServletResponse response) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return reply(403, "EDIT_FORBIDDEN", null);
        Configuration current = current(access);
        if (update.expectedVersion() == null || update.expectedVersion() < 0 || update.values() == null)
            return result(400, "INVALID_SETTINGS", access, request, false);
        if (update.expectedVersion() != current.version()) return result(409, "STALE_VERSION", access, request, false);
        var previous = current.values();
        var values = update.values();
        var localOutputs=local.local(terminalId,"","","printer",PreloginPrintInfoController.LocalPrinters.class,request);
        var displayed=localOutputs.map(PreloginPrintInfoController.LocalPrinters::outputs).orElse(previous.outputs());
        var retained=localOutputs.isPresent()?previous.outputs():values.outputs();
        if (!java.util.Objects.equals(previous.warehouse(), values.warehouse())) return result(403, "WAREHOUSE_ENTRY_REQUIRED", access, request, false);
        boolean sameSections = java.util.Objects.equals(previous.process(), values.process())
                && java.util.Objects.equals(previous.warehouse(), values.warehouse())
                && (values.materials() == null || previous.materials().equals(values.materials()));
        if (sameSections && (displayed.equals(values.outputs()) || registered(values.outputs(), access.catalog()))) {
            if(!writeBoundPrinters(localOutputs,update,terminalId,request,response))return result(409,"STALE_VERSION",access,request,false);
            saved.put(access.scope(), new Configuration(current.version() + 1, new Values(previous.process(), previous.warehouse(),
                    Map.copyOf(retained), previous.materials())));
        } else {
            if (!valid(values, access.catalog(), displayed)) return result(400, "INVALID_SETTINGS", access, request, false);
            if (previous.process().isEmpty() || previous.warehouse().isEmpty() || previous.materials().isEmpty())
                return result(422, "SECTION_REQUIRED", access, request, false);
            synchronized (equipment) {
                if(!writeBoundPrinters(localOutputs,update,terminalId,request,response))return result(409,"STALE_VERSION",access,request,false);
                boolean processChanged = !previous.process().equals(values.process());
                if (processChanged) equipment.clearAfterProcessSave(terminalId, request);
                var materials = processChanged ? List.<String>of() : values.materials() == null ? previous.materials()
                        : access.catalog().materials().stream().map(MaterialSettingsFixture.Quality::code).filter(values.materials()::contains).toList();
                saved.put(access.scope(), new Configuration(current.version() + 1,
                        new Values(values.process(), values.warehouse(), Map.copyOf(retained), materials)));
            }
        }
        return result(200, "SAVED", access, request, false);
    }

    private boolean writeBoundPrinters(java.util.Optional<PreloginPrintInfoController.LocalPrinters> bound,Update update,String terminal,
                                       HttpServletRequest request,jakarta.servlet.http.HttpServletResponse response){
        if(bound.isEmpty() || bound.get().outputs().equals(update.values().outputs()))return true;
        long revision=local.localVersion(terminal,"","","printer",request);
        if(update.printerVersion()!=null && update.printerVersion()!=revision)return false;
        try{
            local.saveLocal(terminal,"","","printer",revision,new PreloginPrintInfoController.LocalPrinters(Map.copyOf(update.values().outputs())),request,response);
            return true;
        }catch(org.springframework.web.server.ResponseStatusException e){if(e.getStatusCode().value()==409)return false;throw e;}
    }
    public record SiteUpdate(Long expectedVersion, Long equipmentVersion, String plant, String center) {}
    public record SectionUpdate(Long expectedVersion, String code, List<String> materials, Map<Integer, String> slots) {}

    @PutMapping("/plant")
    public synchronized ResponseEntity<Reply> savePlant(@PathVariable String terminalId, @RequestBody SiteUpdate update,
            HttpServletRequest request,jakarta.servlet.http.HttpServletResponse response) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return reply(403, "EDIT_FORBIDDEN", null);
        var old = current(access);
        if (!java.util.Objects.equals(update.expectedVersion(), old.version())) return result(409, "STALE_VERSION", access, request, false);
        synchronized (equipment) {
            equipment.changeSite(terminalId, update.plant(), update.center(), update.equipmentVersion(), request,response);
            warehouse.clear(warehouseScope(access));
            saved.put(access.scope(), new Configuration(old.version() + 1, new Values("", "", old.values().outputs(), List.of())));
            return result(200, "SAVED", access, request, false);
        }
    }

    @PutMapping("/equipment/{operation}")
    public synchronized ResponseEntity<EquipmentSettingsController.View> changeEquipment(@PathVariable String terminalId,
            @PathVariable String operation, @RequestBody EquipmentSettingsController.Command command, HttpServletRequest request,
            jakarta.servlet.http.HttpServletResponse response) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return ResponseEntity.status(403).build();
        var old = current(access);
        if (old.values().process().isEmpty()) return ResponseEntity.unprocessableEntity().build();
        synchronized (equipment) {
            var result = equipment.change(terminalId, operation, command, request, response);
            if (operation.equals("machines") && result.getStatusCode().is2xxSuccessful()) {
                var v = old.values();
                saved.put(access.scope(), new Configuration(old.version() + 1, new Values(v.process(), v.warehouse(), v.outputs(), List.of())));
            }
            return result;
        }
    }

    @PutMapping("/section/{section}")
    public synchronized ResponseEntity<Reply> saveSection(@PathVariable String terminalId, @PathVariable String section,
            @RequestBody SectionUpdate update, HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return reply(403, "EDIT_FORBIDDEN", null);
        var old = current(access);
        if (!java.util.Objects.equals(update.expectedVersion(), old.version())) return result(409, "STALE_VERSION", access, request, false);
        var v = old.values();
        var catalog = access.catalog();
        Values next;
        synchronized (equipment) {
            switch (section) {
                case "process" -> {
                    if (update.code() == null || !catalog.processes().contains(update.code())) return result(422, "INVALID_PROCESS", access, request, false);
                    if (update.slots() == null) return result(422, "PROCESS_SLOTS_REQUIRED", access, request, false);
                    equipment.saveSlots(terminalId, update.slots(), catalog.processes(), update.code(), request, response);
                    equipment.clearAfterProcessSave(terminalId, request);
                    next = new Values(update.code(), v.warehouse(), v.outputs(), List.of());
                }
                case "warehouse" -> { return result(403, "WAREHOUSE_ENTRY_REQUIRED", access, request, false); }
                case "materials" -> {
                    if (v.process().isEmpty() || !equipment.read(terminalId, request).getBody().machineSettingsPresent())
                        return result(422, "MACHINE_REQUIRED", access, request, false);
                    var selected = update.materials();
                    var ordered = catalog.materials().stream().map(MaterialSettingsFixture.Quality::code)
                            .filter(code -> selected != null && selected.contains(code)).toList();
                    if (ordered.isEmpty() || ordered.size() != selected.size()) return result(422, "INVALID_MATERIALS", access, request, false);
                    next = new Values(v.process(), v.warehouse(), v.outputs(), ordered);
                }
                default -> { return reply(404, "UNKNOWN_SECTION", null); }
            }
            saved.put(access.scope(), new Configuration(old.version() + 1, next));
            if ("process".equals(section)) equipment.refreshProcessMenu(terminalId,catalog.processNames(),request);
            return result(200, "SAVED", access, request, false);
        }
    }

    public record PrinterUpdate(Long expectedVersion, Map<String, String> outputs,Long printerVersion) {}

    private static boolean registered(Map<String, String> outputs, Catalog catalog) {
        return outputs != null && outputs.keySet().equals(ROLES)
                && outputs.values().stream().allMatch(id -> id != null && catalog.printers().contains(id));
    }

    @PutMapping("/printers")
    public synchronized ResponseEntity<Reply> savePrinters(@PathVariable("terminalId") String terminalId,
            @RequestBody PrinterUpdate update, HttpServletRequest request,jakarta.servlet.http.HttpServletResponse response) {
        var access = access(terminalId, request);
        if (access == null || !access.canEdit()) return reply(403, "EDIT_FORBIDDEN", null);
        if (!registered(update.outputs(), access.catalog())) return result(400, "INVALID_SETTINGS", access, request, false);
        var previous=current(access);
        if(!java.util.Objects.equals(update.expectedVersion(),previous.version()))return result(409,"STALE_VERSION",access,request,false);
        boolean browserBound=local.local(terminalId,"","","printer",PreloginPrintInfoController.LocalPrinters.class,request).isPresent();
        long localVersion=local.localVersion(terminalId,"","","printer",request);
        if(update.printerVersion()!=null && update.printerVersion()!=localVersion)return result(409,"STALE_VERSION",access,request,false);
        try {
            local.saveLocal(terminalId,"","","printer",localVersion,new PreloginPrintInfoController.LocalPrinters(Map.copyOf(update.outputs())),request,response);
        }catch(org.springframework.web.server.ResponseStatusException failure){
            if(failure.getStatusCode().value()==409)return result(409,"STALE_VERSION",access,request,false);
            throw failure;
        }
        var values=previous.values();
        saved.put(access.scope(),new Configuration(previous.version()+1,new Values(values.process(),values.warehouse(),
                browserBound?values.outputs():Map.copyOf(update.outputs()),values.materials())));
        return result(200,"SAVED",access,request,false);
    }

    @PostMapping("/refresh")
    public synchronized ResponseEntity<Reply> refresh(@PathVariable("terminalId") String terminalId,
                                                        HttpServletRequest request) {
        var access = access(terminalId, request);
        if (access == null) return reply(403, "TERMINAL_SCOPE", null);
        return result(200, "APPLIED", access, request, true);
    }

    private Access access(String target, HttpServletRequest request) {
        return access(target, DemoSessionController.requireIdentity(request),request);
    }

    private Access access(String target, DemoSessionController.Identity identity) { return access(target,identity,null); }
    private Access access(String target, DemoSessionController.Identity identity,HttpServletRequest request) {
        var terminal = identity.terminal();
        // The catalog is partitioned by the authenticated terminal and factory, never by a client-selected scope.
        if (!terminal.id().equals(target)) return null;
        String prefix = switch (terminal.id()) {
            case "DEMO-A" -> "A";
            case "DEMO-A2" -> "A2";
            case "DEMO-B" -> "B";
            default -> null;
        };
        if (prefix == null) return null;
        var scope = new Scope(terminal.factory(), terminal.id());
        boolean canEdit = identity.worker().id().equals(administratorId(terminal.id()));
        var devices = TerminalPrinterFixture.registered(prefix);
        var outputs = devices.stream().flatMap(id -> List.of("document", "shipment", "label").stream()
                .map(role -> new Output(id, role))).toList();
        var capture = equipment.referenceFor(identity,request);
        if (capture.isPresent()) {
            var source = capture.get();
            var names = new HashMap<String,String>();
            var indices = new HashMap<String,Integer>();
            source.processes().forEach(row -> {
                names.put(row.code(), row.name());
                indices.put(row.code(), row.idx());
            });
            return new Access(scope, new Catalog(source.processes().stream().map(LocalSettingsReference.Process::code).toList(),
                    source.warehouses().stream().map(LocalSettingsReference.Row::code).toList(), outputs, devices,
                    source.materials().stream().map(row -> new MaterialSettingsFixture.Quality(row.code(), row.name(), row.idx())).toList(),
                    Map.copyOf(names), Map.copyOf(indices)), canEdit, source);
        }
        return new Access(scope, new Catalog(
                List.of(prefix + "-CUT", prefix + "-PACK"),
                List.of(prefix + "-STOCK", prefix + "-RETURN"),
                outputs, devices, MaterialSettingsFixture.forTerminal(prefix),
                Map.of(prefix + "-CUT", "합성 절단", prefix + "-PACK", "합성 포장"), Map.of()), canEdit, null);
    }

    private static boolean valid(Values values, Catalog catalog, Map<String, String> previousOutputs) {
        if (values == null || values.process() == null || values.warehouse() == null || values.outputs() == null
                || !catalog.processes().contains(values.process()) || !catalog.warehouses().contains(values.warehouse())
                || !values.outputs().keySet().equals(ROLES)) return false;
        List<String> selected = values.materials();
        if (selected != null && (selected.isEmpty() || selected.stream().anyMatch(java.util.Objects::isNull)
                || selected.stream().distinct().count() != selected.size()
                || !catalog.materials().stream().map(MaterialSettingsFixture.Quality::code).toList().containsAll(selected))) {
            return false;
        }
        return previousOutputs.equals(values.outputs()) || registered(values.outputs(), catalog);
    }

    private Configuration current(Access access) {
        return saved.computeIfAbsent(access.scope(), scope -> {
            if (access.reference() != null) {
                var original = access.reference().originalSelection();
                var process = new java.util.TreeMap<>(access.reference().selectedSlots()).values().stream().findFirst().orElse("");
                var roles = new WarehouseSettings.Rules(original.warehouses());
                warehouse.seed(warehouseScope(access), roles);
                var issued = roles.roles().get("issue").stream().findFirst().orElse("");
                return new Configuration(0, new Values(process, issued, Map.of("document","NONE","shipment","NONE","label","NONE"), original.materials()));
            }
            Catalog catalog = access.catalog();
            return new Configuration(0, new Values(catalog.processes().get(0), catalog.warehouses().get(0),
                    Map.of("document", "NONE", "shipment", "NONE", "label", "NONE"), List.of(catalog.materials().get(0).code())));
        });
    }

    private static Configuration applied(Access access, HttpServletRequest request, Configuration latest, boolean refresh) {
        var session = request.getSession(false);
        if (!refresh) {
            if (session.getAttribute(APPLIED) instanceof SessionSettings previous
                    && previous.scope().equals(access.scope())) return previous.configuration();
            throw new IllegalStateException("Session settings were not pinned at login");
        }
        session.setAttribute(APPLIED, new SessionSettings(access.scope(), latest));
        return latest;
    }

    private Configuration withLocalPrinters(Access access,HttpServletRequest request) {
        var base=current(access);
        var selected=local.local(access.scope().terminal(),"","","printer",PreloginPrintInfoController.LocalPrinters.class,request);
        if(selected.isEmpty())return base;
        var values=base.values();
        return new Configuration(base.version(),new Values(values.process(),values.warehouse(),selected.get().outputs(),values.materials()));
    }
    private ResponseEntity<Reply> result(int status, String code, Access access, HttpServletRequest request, boolean refresh) {
        var latest = withLocalPrinters(access,request);
        var catalog = access.catalog();
        if (access.reference() != null) {
            // Return the full warehouse list only through the password-protected dialog.
            catalog = new Catalog(catalog.processes(), List.of(), catalog.outputs(), catalog.printers(),
                    catalog.materials(), catalog.processNames(), catalog.processIndices());
        }
        return reply(status, code, new View(access.scope().terminal(), access.canEdit(), catalog,
                latest, applied(access, request, latest, refresh), warehouse.configured(warehouseScope(access), !latest.values.warehouse.isEmpty()), equipment.processSelection(access.scope().terminal(), request),
                local.localVersion(access.scope().terminal(),"","","printer",request)));
    }

    private static ResponseEntity<Reply> reply(int status, String code, View view) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Reply(code, view));
    }
}
