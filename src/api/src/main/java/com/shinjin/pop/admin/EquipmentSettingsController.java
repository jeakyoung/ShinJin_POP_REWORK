package com.shinjin.pop.admin;

import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.history.WorkHistoryFixtures;
import com.shinjin.pop.history.WorkHistoryFixtures.Station;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

import static com.shinjin.pop.admin.EquipmentSettingsFixture.*;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/admin/terminal-settings/{terminalId}/equipment")
public final class EquipmentSettingsController {
    public record Step(String process, String warehouse) {}
    public record Group(String number, String start, String end, List<Step> steps) {}
    public record LocalSettings(List<String> machines, Group group, String popId) {}
    public record MachineRow(String code, String name, String description, String owner) {}
    public record PopRow(String code, String name, String owner) {}
    public record View(Site site, List<Site> sites, List<PopRow> popRows, Map<Integer, String> slotCodes, long version, boolean groupCenter, boolean machineSettingsPresent, boolean canEdit, List<MachineRow> machines,
                       List<Group> groups, List<Item> processes, List<Item> warehouses, LocalSettings saved, LocalSettings applied, Long siteRevision) {}
    public record Command(Long expectedVersion, List<String> machines, String number, String side, List<Step> steps) {}
    private record TerminalKey(String factory, String id) {}
    private record Plant(String factory, String plant) {}
    private record MachineKey(String center, String code) {}
    private record Access(String id, Plant plant, String center, boolean group, boolean edit, Site site, List<Site> sites) {}
    private static final String APPLIED = EquipmentSettingsController.class.getName() + ".applied";
    private static final LocalSettings EMPTY = new LocalSettings(List.of(), null, "");
    private static final class State {
        long version;
        int sequence;
        final Map<MachineKey, String> popOwners = new HashMap<>();
        final Map<MachineKey, String> owners = new HashMap<>();
        final Map<String, Group> groups = new LinkedHashMap<>();
        final Map<String, LocalSettings> local = new HashMap<>();
    }
    private final Map<TerminalKey, Site> configuredSites = new HashMap<>();
    private final Map<TerminalKey, List<Site>> catalogs = new HashMap<>();
    private final Map<TerminalKey, Map<Integer, String>> slotSettings = new HashMap<>();
    private final Set<TerminalKey> clearedMachineFiles = new HashSet<>();
    private long revision;
    private TerminalKey key(Access a) { return new TerminalKey(a.plant().factory(), a.id()); }
    private Map<Integer, String> slots(Access a) {
        var explicit = slotSettings.get(key(a));
        if (explicit != null) return explicit;
        var snapshot = reference.forSite(a.id(), a.site().plant(), a.center());
        if (snapshot.isPresent()) return snapshot.get().selectedSlots();
        var station = fixtures.station(a.id());
        var inherited = new TreeMap<Integer, String>();
        if (station != null) {
            var menu=fixtures.menuProcesses(a.id());
            for (int slot:station.slots()) {
                String nativeCode=menu.slots().get(slot);
                String configured=menu.settings().entrySet().stream().filter(entry->entry.getValue().equals(nativeCode))
                        .map(Map.Entry::getKey).sorted().findFirst().orElse("");
                inherited.put(slot,configured);
            }
        }
        return inherited;
    }

    private static final String STATION = APPLIED + ".station";
    private static final String MACHINE_DOCK = APPLIED + ".machineDock";
    public record DockMachine(String code, String name, String ledgerKey) {}
    public static List<DockMachine> dockMachines(HttpServletRequest request) {
        Object pinned = request.getSession(false).getAttribute(MACHINE_DOCK);
        if (!(pinned instanceof List<?> rows)) return List.of();
        return rows.stream().map(DockMachine.class::cast).toList();
    }
    private final WorkHistoryFixtures fixtures;
    private final Map<Plant, State> plants = new HashMap<>();

    private final LocalSettingsReference reference;
    private final PreloginDetailStore localStore;
    public record MachineSelection(List<String> codes, long assignedAt) {}
    public record PopSelection(String code, long assignedAt) {}
    private Optional<LocalSettingsReference.Site> browserSite(String id, HttpServletRequest request) {
        return request==null ? Optional.empty() : localStore.local(id,"","","plant",LocalSettingsReference.Site.class,request);
    }
    private Optional<LocalSettingsReference.Devices> deviceMaster(Access a) {
        return reference.forSite(a.id(),a.site().plant(),a.center()).map(LocalSettingsReference.Snapshot::devices);
    }
    private List<LocalSettingsReference.Device> machineRows(Access a) {
        var source=reference.forSite(a.id(),a.site().plant(),a.center());
        if(source.isPresent()) {
            var rows=new ArrayList<LocalSettingsReference.Device>();
            rows.add(new LocalSettingsReference.Device(NONE,"NONE","설비없음","free"));
            deviceMaster(a).ifPresent(d->rows.addAll(d.machines()));
            return rows;
        }
        return MACHINES.stream().map(m->new LocalSettingsReference.Device(m.code(),m.name(),m.description(),"free")).toList();
    }
    private List<LocalSettingsReference.Device> popRows(Access a) {
        if(reference.forSite(a.id(),a.site().plant(),a.center()).isPresent())
            return deviceMaster(a).map(LocalSettingsReference.Devices::popRows).orElse(List.of());
        return POP_EQUIPMENT.stream().map(p->new LocalSettingsReference.Device(p.code(),p.name(),"","free")).toList();
    }
    private String sourceOwner(Access a,LocalSettingsReference.Device row) {
        return switch(row.ownership()) { case "self" -> a.id(); case "other" -> "다른 단말"; default -> ""; };
    }
    private LocalSettings saved(Access a,HttpServletRequest request) {
        var fromSnapshot=deviceMaster(a).map(d->new LocalSettings(d.selectedMachineCodes(),null,d.popFilePresent()?a.id():"")).orElse(EMPTY);
        var original=state(a).local.getOrDefault(a.id(), fromSnapshot);
        boolean reset=browserSite(a.id(),request).isPresent();
        var detail=localStore.pin(a.id(),a.site().plant(),a.center(),request);
        var cleared=reset || detail.map(PreloginDetailStore.LocalPin::slots).isPresent();
        var machines=localStore.local(a.id(),a.site().plant(),a.center(),"machine",MachineSelection.class,request)
                .map(MachineSelection::codes).orElse(cleared?List.of():original.machines());
        var pop=localStore.local(a.id(),a.site().plant(),a.center(),"popId",PopSelection.class,request)
                .map(value->a.id()).orElse(cleared?"":original.popId());
        return new LocalSettings(machines,reset?null:original.group(),pop);
    }


    public EquipmentSettingsController(WorkHistoryFixtures fixtures, LocalSettingsReference reference, PreloginDetailStore localStore) {
        this.fixtures = fixtures;
        this.reference = reference;
        this.localStore = localStore;
    }

    public synchronized String configuredPlant(DemoSessionController.Identity identity) {
        return access(identity).site().plant();
    }

    public synchronized Optional<LocalSettingsReference.Snapshot> referenceFor(DemoSessionController.Identity identity,HttpServletRequest request) {
        var a = access(identity,request);
        return reference.forSite(a.id(), a.site().plant(), a.center());
    }

    public synchronized Optional<LocalSettingsReference.Site> configuredSite(String factory, String terminalId) {
        return Optional.ofNullable(configuredSites.get(new TerminalKey(factory,terminalId)))
                .map(site -> new LocalSettingsReference.Site(factory,site.plant(),site.center(),site.plantName(),site.centerName()));
    }

    public synchronized boolean isConfiguredGroupCenter(String factory, String terminal) {
        var site = configuredSites.get(new TerminalKey(factory, terminal));
        if (site != null) return "005".equals(site.center()) || "105".equals(site.center());
        var captured = reference.siteFor(terminal);
        if (captured.isPresent()) return List.of("005", "105").contains(captured.get().center());
        var station = fixtures.station(terminal);
        return station != null && station.groupCenter();
    }

    private Access access(DemoSessionController.Identity identity) { return access(identity,null); }
    private Access access(DemoSessionController.Identity identity,HttpServletRequest request) {
        return access(identity.terminal(),identity.worker().id().equals(TerminalSettingsDemoController.administratorId(identity.terminal().id())),request);
    }
    private Access access(DemoSessionController.AssignedTerminal terminal, boolean edit, HttpServletRequest request) {
        var plant = PLANTS.get(terminal.id());
        if (plant == null || terminal.factory().isBlank()) throw error(HttpStatus.CONFLICT, "PLANT_REQUIRED");
        var station = fixtures.station(terminal.id());
        String center = station == null ? "DEMO-WC-" + terminal.id() : station.center();
        var key = new TerminalKey(terminal.factory(), terminal.id());
        var sites = catalogs.computeIfAbsent(key, ignored -> reference.siteFor(terminal.id())
                .map(source -> List.of(new Site(source.plant(), source.plantName(), source.center(), source.centerName(), "")))
                .orElseGet(() -> EquipmentSettingsFixture.sites(plant, center, terminal.workCenter())));
        var site = configuredSites.getOrDefault(key, sites.stream().filter(row -> row.plant().equals(plant)
                && row.center().equals(center)).findFirst().orElse(sites.get(0)));
        var local=browserSite(terminal.id(),request);
        if(local.isPresent()) {
            var target=local.get();
            site=sites.stream().filter(candidate->candidate.plant().equals(target.plant()) && candidate.center().equals(target.center()))
                    .findFirst().orElseThrow(()->error(HttpStatus.CONFLICT,"PLANT_REQUIRED"));
        }
        return new Access(terminal.id(), new Plant(terminal.factory(), site.plant()), site.center(),
                "005".equals(site.center()) || "105".equals(site.center()),
                edit, site, sites);
    }

    synchronized PreloginGroupState groupRegistryCopy(String terminalId, String plant) {
        var terminal = com.shinjin.pop.history.PreloginTerminalLookup.require(fixtures, terminalId);
        var source = plants.get(new Plant(terminal.factory(), plant));
        return source == null ? new PreloginGroupState(0, List.of(), null, List.of()) :
                new PreloginGroupState(source.sequence, List.copyOf(source.groups.values()), null, List.of());
    }

    private State state(Access a) { return plants.computeIfAbsent(a.plant(), ignored -> new State()); }

    synchronized DemoSessionController.Identity pin(DemoSessionController.Identity identity, HttpServletRequest request) {
        if (!PLANTS.containsKey(identity.terminal().id())) return identity;
        var a = access(identity,request);
        var session = request.getSession(false);
        var local = saved(a,request);
        session.setAttribute(APPLIED, local);
        var machineMaster=machineRows(a);
        var dock=local.machines().stream().filter(code->!NONE.equals(code)).flatMap(code->machineMaster.stream()
                .filter(machine->machine.code().equals(code)).limit(1).map(machine->new DockMachine(code,machine.name(),
                        String.join("/",a.plant().factory(),a.site().plant(),a.center(),code)))).toList();
        session.setAttribute(MACHINE_DOCK,dock);
        session.setAttribute(STATION+".site",a.site());
        var captured = reference.forSite(a.id(), a.site().plant(), a.center());
        pinGroupStages(a, local.group(), request);
        PreloginGroupState.pin(localStore, a.id(), a.site().plant(), a.center(), request, APPLIED);
        var savedBrowser = localStore.pin(a.id(), a.site().plant(), a.center(), request);
        var browserSlots = savedBrowser.map(PreloginDetailStore.LocalPin::slots);
        savedBrowser.ifPresent(saved -> PreloginSessionValues.pin(
                saved.slots() == null ? null : resolveWorkCodes(a, saved.slots()), saved.materials(), saved.warehouses(), request));
        boolean siteReset=browserSite(a.id(),request).isPresent();
        if (!siteReset && browserSlots.isEmpty() && captured.isEmpty() && !configuredSites.containsKey(key(a)) && !slotSettings.containsKey(key(a))) return identity;
        var original = fixtures.station(a.id());
        var selected = browserSlots.orElseGet(() -> siteReset ? Map.of() : slots(a));
        var assignedSlots = selected.keySet().stream().sorted().toList();
        var station = new Station(a.id() + "/" + a.site().plant() + "/" + a.center(), a.center(), assignedSlots, List.of(), "", 0);
        if (original != null && original.center().equals(a.center()) && PLANTS.get(a.id()).equals(a.site().plant())) {
            var stages = siteReset || configuredSites.containsKey(key(a)) ? List.<WorkHistoryFixtures.Stage>of() : original.stages();
            station = new Station(original.profile(), a.center(), assignedSlots, stages, original.inputLot(), original.inputQty());
        }
        session.setAttribute(STATION, station);
        var terminal = identity.terminal();
        var workCodes = resolveWorkCodes(a, selected);
        return new DemoSessionController.Identity(new DemoSessionController.AssignedTerminal(terminal.id(), terminal.name(),
                terminal.factory(), a.site().centerName()), identity.worker(), station.groupCenter(), station.initialView(), station.packMenu(), station.center(), station.slots(), Map.copyOf(workCodes));
    }

    private Map<Integer,String> resolveWorkCodes(Access a, Map<Integer,String> selected) {
        var workCodes = new HashMap<Integer,String>();
        var captured=reference.forSite(a.id(),a.site().plant(),a.center());
        var menu = fixtures.menuProcesses(a.id());
        selected.forEach((slot,code) -> {
            String workCode = captured.isPresent() ? captured.get().menuWorkCode(code).orElse(null)
                    : code.isEmpty() ? menu.slots().get(slot) : menu.settings().get(code);
            if (workCode != null) workCodes.put(slot,workCode);
        });
        return Map.copyOf(workCodes);
    }

    synchronized DemoSessionController.Identity withWorkNames(DemoSessionController.Identity identity,
                                                              Map<String,String> names, HttpServletRequest request) {
        var a=access(identity,request);
        var result=new TreeMap<Integer,String>();
        editableSlots(a,request).forEach((slot,code)->{
            String name=names.get(code);
            if(name!=null && !name.isBlank()) result.put(slot,name);
        });
        return identity.withWorkNames(result);
    }

    synchronized void refreshProcessMenu(String terminalId,Map<String,String> names,HttpServletRequest request) {
        var previous=DemoSessionController.requireIdentity(request);
        var a=authorize(terminalId,request,true);
        var session=request.getSession(false);
        if (!a.site().equals(session.getAttribute(STATION+".site"))) return;
        var active=slots(a).keySet().stream().sorted().toList();
        var workCodes=resolveWorkCodes(a,slots(a));
        var original=appliedStation(fixtures.station(terminalId),request);
        if(original==null) return;
        var station=new Station(original.profile(),a.center(),active,original.stages(),original.inputLot(),original.inputQty());
        session.setAttribute(STATION,station);
        PreloginSessionValues.refreshProcesses(workCodes,request);
        var updated=new DemoSessionController.Identity(previous.terminal(),previous.worker(),station.groupCenter(),station.initialView(),
                station.packMenu(),station.center(),active,workCodes);
        DemoSessionController.updateProcessIdentity(withWorkNames(updated,names,request),request);
    }

    private void pinGroupStages(Access a, Group group, HttpServletRequest request) {
        var session = request.getSession(false);
        if (!a.group() || group == null) {
            session.removeAttribute(APPLIED + ".stages");
            return;
        }
        var processes = groupProcesses(a);
        var warehouses = groupWarehouses(a);
        var stages = group.steps().stream().map(step -> new WorkHistoryFixtures.Stage(
                name(processes, step.process()), name(warehouses, step.warehouse()),
                step.process(), step.warehouse())).toList();
        session.setAttribute(APPLIED + ".stages", stages);
    }

    public static Station appliedStation(Station fallback, HttpServletRequest request) {
        var session = request.getSession(false);
        var station = session.getAttribute(STATION) instanceof Station pinned ? pinned : fallback;
        if (station != null && station.groupCenter() && session.getAttribute(APPLIED + ".stages") instanceof List<?> stages) {
            station = new Station(station.profile(), station.center(), station.slots(), stages.stream().map(WorkHistoryFixtures.Stage.class::cast).toList(),
                    station.inputLot(), station.inputQty());
        }
        return PreloginSessionValues.applyStation(station, request);
    }

    private List<Item> groupProcesses(Access a) {
        return reference.groupProcessesFor(a.id(), a.site().plant(), a.center())
                .map(rows -> rows.stream().map(row -> new Item(row.code(), row.name())).toList()).orElse(PROCESSES);
    }

    private List<Item> groupWarehouses(Access a) {
        return reference.warehousesFor(a.id(), a.site().plant(), a.center())
                .map(rows -> rows.stream().map(row -> new Item(row.code(), row.name())).toList()).orElse(WAREHOUSES);
    }

    private static String name(List<Item> items, String code) {
        return items.stream().filter(item -> item.code().equals(code)).findFirst().orElseThrow().name();
    }

    private Access authorize(String target, HttpServletRequest request, boolean writing) {
        var identity = DemoSessionController.requireIdentity(request);
        if (!identity.terminal().id().equals(target) || TerminalSettingsDemoController.administratorId(target) == null)
            throw error(HttpStatus.FORBIDDEN, "TERMINAL_SCOPE");
        var a = access(identity,request);
        if (writing && !a.edit()) throw error(HttpStatus.FORBIDDEN, "EDIT_FORBIDDEN");
        return a;
    }

    synchronized View anonymousView(String terminalId,String kind,boolean missingPlant,HttpServletRequest request) {
        var terminal=com.shinjin.pop.history.PreloginTerminalLookup.require(fixtures,terminalId);
        var assigned=new DemoSessionController.AssignedTerminal(terminal.id(),terminal.name(),terminal.factory(),terminal.workCenter());
        var a=access(assigned,true,request);
        var base=view(a,request);
        var version=kind.equals("plant")?localStore.localVersion(terminalId,"","","plant",request):
                localStore.localVersion(terminalId,a.site().plant(),a.center(),kind,request);
        var blank=new Site("","","","","");
        return new View(missingPlant?blank:a.site(),a.sites(),base.popRows(),Map.of(),version,a.group(),base.machineSettingsPresent(),
                true,base.machines(),List.of(),List.of(),List.of(),base.saved(),EMPTY,localStore.localVersion(terminalId,"","","plant",request));
    }

    private View view(Access a, HttpServletRequest request) {
        var state = state(a);
        var sources=machineRows(a);var popSources=popRows(a);
        var machineOwners=new HashMap<MachineKey,String>();var popOwners=new HashMap<MachineKey,String>();
        sources.forEach(row->machineOwners.put(new MachineKey(a.center(),row.code()),sourceOwner(a,row)));
        popSources.forEach(row->popOwners.put(new MachineKey(a.center(),row.code()),sourceOwner(a,row)));
        machineOwners.putAll(state.owners);popOwners.putAll(state.popOwners);
        var machineDates=new HashMap<MachineKey,Long>();var popDates=new HashMap<MachineKey,Long>();
        for (var terminal:com.shinjin.pop.history.PreloginTerminalLookup.sameFactory(fixtures,a.plant().factory())) {
            var machines=localStore.local(terminal,a.site().plant(),a.center(),"machine",MachineSelection.class,request);
            var pop=localStore.local(terminal,a.site().plant(),a.center(),"popId",PopSelection.class,request);
            machines.ifPresent(selection->{
                machineOwners.values().removeIf(terminal::equals);
                for (var code:selection.codes()) if(!code.equals(NONE)) {
                    var key=new MachineKey(a.center(),code);
                    if(selection.assignedAt()>=machineDates.getOrDefault(key,0L)) {
                        machineDates.put(key,selection.assignedAt());machineOwners.put(key,terminal);
                    }
                }
            });
            pop.ifPresent(selection->{
                popOwners.values().removeIf(terminal::equals);
                var key=new MachineKey(a.center(),selection.code());
                if(selection.assignedAt()>=popDates.getOrDefault(key,0L)) {
                    popDates.put(key,selection.assignedAt());popOwners.put(key,terminal);
                }
            });
        }
        var rows = sources.stream().map(m -> new MachineRow(m.code(), m.name(), m.description(),
                machineOwners.getOrDefault(new MachineKey(a.center(), m.code()), ""))).toList();
        var pops = popSources.stream().map(p -> new PopRow(p.code(), p.name(),
                popOwners.getOrDefault(new MachineKey(a.center(), p.code()), ""))).toList();
        var saved=saved(a,request);
        var machineSettingsPresent = !saved.machines().isEmpty() ||
                browserSite(a.id(),request).isEmpty() && localStore.pin(a.id(),a.site().plant(),a.center(),request)
                        .map(PreloginDetailStore.LocalPin::slots).isEmpty() && !clearedMachineFiles.contains(key(a)) &&
                reference.forSite(a.id(), a.site().plant(), a.center()).map(LocalSettingsReference.Snapshot::machineSettingsFilePresent).orElse(false);
        var session=request.getSession(false);
        return new View(a.site(), a.sites(), pops, editableSlots(a,request), state.version, a.group(), machineSettingsPresent, a.edit(), rows, a.group() ? List.copyOf(state.groups.values()) : List.of(),
                a.group() ? groupProcesses(a) : List.of(), a.group() ? groupWarehouses(a) : List.of(), saved,
                session==null?EMPTY:(LocalSettings)session.getAttribute(APPLIED),null);
    }

    @GetMapping
    public synchronized ResponseEntity<View> read(@PathVariable String terminalId, HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(view(authorize(terminalId, request, false), request));
    }

    synchronized ResponseEntity<View> change(String terminalId, String operation, Command command, HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response) {
        var a = authorize(terminalId, request, true);
        var state = state(a);
        if (!"machines".equals(operation) && !"pop-id".equals(operation) && !a.group()) throw error(HttpStatus.FORBIDDEN, "GROUP_CENTER_REQUIRED");
        if (command.expectedVersion() == null || command.expectedVersion() < 0) throw invalid();
        if (command.expectedVersion() != state.version)
            return ResponseEntity.status(409).cacheControl(CacheControl.noStore()).body(view(a, request));
        var saved = state.local.getOrDefault(a.id(), EMPTY);
        switch (operation) {
            case "machines" -> {
                var selected = command.machines();
                if (selected == null || selected.isEmpty() || selected.size() > 6 || selected.contains(NONE) && selected.size() != 1) throw invalid();
                var ordered = machineRows(a).stream().map(LocalSettingsReference.Device::code).filter(selected::contains).toList();
                if (ordered.size() != selected.size()) throw invalid();
                localStore.saveLocal(a.id(),a.site().plant(),a.center(),"machine",
                        localStore.localVersion(a.id(),a.site().plant(),a.center(),"machine",request),
                        new MachineSelection(ordered,System.currentTimeMillis()),request,response);
                state.owners.values().removeIf(a.id()::equals);
                for (String code : ordered) if (!code.equals(NONE)) state.owners.put(new MachineKey(a.center(), code), a.id());
                state.local.put(a.id(), new LocalSettings(ordered, saved.group(), saved.popId()));
            }
            case "pop-id" -> {
                if (popRows(a).stream().noneMatch(p -> p.code().equals(command.number()))) throw invalid();
                localStore.saveLocal(a.id(),a.site().plant(),a.center(),"popId",
                        localStore.localVersion(a.id(),a.site().plant(),a.center(),"popId",request),
                        new PopSelection(command.number(),System.currentTimeMillis()),request,response);
                state.popOwners.values().removeIf(a.id()::equals);
                state.popOwners.put(new MachineKey(a.center(), command.number()), a.id());
                state.local.put(a.id(), new LocalSettings(saved.machines(), saved.group(), a.id()));
            }
            case "add" -> {
                if (state.sequence >= 999) throw error(HttpStatus.UNPROCESSABLE_ENTITY, "FIXTURE_NUMBERS_EXHAUSTED");
                String number = String.format(Locale.ROOT, "%03d", ++state.sequence);
                state.groups.put(number, new Group(number, "", "", List.of()));
            }
            case "remove", "processes", "assign" -> {
                var row = state.groups.get(command.number());
                if (row == null) throw invalid();
                if (operation.equals("remove")) state.groups.remove(row.number());
                else if (operation.equals("processes")) {
                    var steps = command.steps();
                    if (steps == null || steps.isEmpty()) throw invalid();
                    var codes = new HashSet<String>();
                    for (Step step : steps) if (step == null || !codes.add(step.process())
                            || groupProcesses(a).stream().noneMatch(i -> i.code().equals(step.process()))
                            || groupWarehouses(a).stream().noneMatch(i -> i.code().equals(step.warehouse()))) throw invalid();
                    state.groups.put(row.number(), new Group(row.number(), row.start(), row.end(), List.copyOf(steps)));
                } else {
                    if (!"START".equals(command.side()) && !"END".equals(command.side())) throw invalid();
                    var session = request.getSession(false);
                    boolean sameSite = a.site().equals(session.getAttribute(STATION + ".site"));
                    if (sameSite) pinGroupStages(a, row, request);
                    state.groups.replaceAll((number, g) -> new Group(number, a.id().equals(g.start()) ? "" : g.start(),
                            a.id().equals(g.end()) ? "" : g.end(), g.steps()));
                    Group displayed = row;
                    row = state.groups.get(row.number());
                    var assigned = new Group(row.number(), "START".equals(command.side()) ? a.id() : row.start(),
                            "END".equals(command.side()) ? a.id() : row.end(), row.steps());
                    state.groups.put(row.number(), assigned);
                    // The INI writer takes the opposite ID from the displayed row, before the registry update.
                    Group local = new Group(row.number(), "START".equals(command.side()) ? a.id() : displayed.start(),
                            "END".equals(command.side()) ? a.id() : displayed.end(), row.steps());
                    state.local.put(a.id(), new LocalSettings(saved.machines(), local, saved.popId()));
                    if (sameSite) {
                        var applied = session.getAttribute(APPLIED) instanceof LocalSettings prior ? prior : EMPTY;
                        session.setAttribute(APPLIED, new LocalSettings(applied.machines(), local, applied.popId()));
                    }
                }
            }
            default -> throw error(HttpStatus.NOT_FOUND, "UNKNOWN_OPERATION");
        }
        state.version = ++revision;
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(view(a, request));
    }

    synchronized void changeSite(String terminalId, String plant, String center, Long expected, HttpServletRequest request,jakarta.servlet.http.HttpServletResponse response) {
        var a = authorize(terminalId, request, true);
        var state = state(a);
        if (expected == null) throw invalid();
        if (state.version != expected) throw error(HttpStatus.CONFLICT, "STALE_VERSION");
        var next = a.sites().stream().filter(site -> site.plant().equals(plant) && site.center().equals(center))
                .findFirst().orElseThrow(EquipmentSettingsController::invalid);
        localStore.saveLocal(a.id(),"","","plant",localStore.localVersion(a.id(),"","","plant",request),
                new LocalSettingsReference.Site(a.plant().factory(),next.plant(),next.center(),next.plantName(),next.centerName()),request,response);
        state.local.remove(a.id());
        state.version = ++revision;
        configuredSites.put(key(a), next);
        clearedMachineFiles.add(key(a));
        slotSettings.put(key(a), Map.of());
        var destination = state(authorize(terminalId, request, true));
        destination.local.remove(a.id());
        destination.version = revision;
    }

    public record ProcessSelection(boolean groupCenter, Map<Integer, String> codes) {}
    synchronized ProcessSelection processSelection(String terminalId, HttpServletRequest request) {
        var a = authorize(terminalId, request, false);
        return new ProcessSelection(a.group(), editableSlots(a, request));
    }

    private Map<Integer,String> editableSlots(Access a, HttpServletRequest request) {
        return localStore.pin(a.id(), a.site().plant(), a.center(), request)
                .map(PreloginDetailStore.LocalPin::slots).orElseGet(() -> browserSite(a.id(),request).isPresent()?Map.of():slots(a));
    }

    synchronized void saveSlots(String terminalId, Map<Integer, String> selected, List<String> candidates, String code,
            HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response) {
        var a = authorize(terminalId, request, true);
        var previous = editableSlots(a,request);
        if (selected.isEmpty() || selected.size() > 6 || !selected.containsValue(code)) throw invalid();
        for (int slot = 1; slot <= 5 && a.group(); slot++) {
            if (!Objects.equals(previous.get(slot), selected.get(slot))) throw invalid();
        }
        for (var entry : selected.entrySet()) {
            Integer slot = entry.getKey();
            String value = entry.getValue();
            if (slot == null || slot < 1 || slot > 6 || value == null) throw invalid();
            if (!candidates.contains(value) && !(value.isEmpty() && value.equals(previous.get(slot)))) throw invalid();
        }
        localStore.saveAuthenticatedProcesses(a.id(), a.site().plant(), a.center(), selected, request, response);
        slotSettings.put(key(a), Map.copyOf(selected));
    }

    synchronized void clearAfterProcessSave(String terminalId, HttpServletRequest request) {
        var a = authorize(terminalId, request, true);
        var state = state(a);
        var prior = state.local.getOrDefault(a.id(), EMPTY);
        clearedMachineFiles.add(key(a));
        state.local.put(a.id(), new LocalSettings(List.of(), prior.group(), ""));
        state.version = ++revision;
    }

    private static ResponseStatusException invalid() { return error(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_EQUIPMENT_SETTINGS"); }
    private static ResponseStatusException error(HttpStatus status, String reason) { return new ResponseStatusException(status, reason); }
}
