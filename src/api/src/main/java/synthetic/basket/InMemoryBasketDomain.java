package synthetic.basket;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

public final class InMemoryBasketDomain implements BasketDomain {
    private static final BigDecimal ZERO = new BigDecimal("0.000");
    private static final BigDecimal MAX = new BigDecimal("999999.999");
    private static final Comparator<PlanKey> KEY_ORDER = Comparator.comparing(PlanKey::date)
            .thenComparingInt(PlanKey::sequence);
    private static final Comparator<Lot> LOT_ORDER = Comparator.comparing(Lot::item).thenComparing(Lot::lot)
            .thenComparing(Lot::warehouse).thenComparing(Lot::position);
    private record Receipt(Actor actor, Command command, Result result) {}

    private static final class Ledger {
        final Seed seed;
        final Map<PlanKey, Work> work = new LinkedHashMap<>();
        final Map<String, Group> groups = new LinkedHashMap<>();
        final Map<String, Receipt> receipts = new HashMap<>();
        long revision;
        long sequence;

        Ledger(Seed seed) {
            this.seed = seed;
            seed.work().forEach(row -> work.put(row.plan().key(), row));
            seed.groups().forEach(group -> groups.put(group.id(), group));
        }
    }

    private final Map<Scope, Ledger> ledgers = new HashMap<>();
    private final Clock clock;
    private final Map<Lot, DisplayLot> materialSpecs;

    public InMemoryBasketDomain(Clock clock, Map<Scope, Seed> seeds) {
        this(clock, seeds, List.of());
    }

    public InMemoryBasketDomain(Clock clock, Map<Scope, Seed> seeds, List<DisplayLot> displayLots) {
        this.clock = Objects.requireNonNull(clock);
        materialSpecs = displayLots.stream().collect(Collectors.toUnmodifiableMap(DisplayLot::lot, row -> row));
        seeds.forEach((scope, seed) -> ledgers.put(scope, new Ledger(seed)));
    }

    @Override
    public synchronized Reply<View> view(Actor actor) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.scope());
        if (!allowed(ledger, actor)) return fail(403, "TERMINAL_OUT_OF_SCOPE");
        var reserved = reservations(ledger, Set.of());
        var materials = ledger.seed.stock().entrySet().stream().sorted(Map.Entry.comparingByKey(LOT_ORDER))
                .map(entry -> new Material(entry.getKey(),
                        entry.getValue().subtract(reserved.getOrDefault(entry.getKey(), ZERO)))).toList();
        return ok(new View(actor, ledger.seed.mode(), ledger.seed.terminals().get(actor.terminal()), ledger.revision,
                List.copyOf(ledger.work.values()), List.copyOf(ledger.groups.values()), materials,
                ledger.seed.returnCandidates().stream().sorted(LOT_ORDER).toList()));
    }

    @Override
    public synchronized Reply<Result> execute(Actor actor, Command raw, Set<Lot> queried) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.scope());
        if (!allowed(ledger, actor) || !ledger.seed.terminals().get(actor.terminal())) {
            return fail(403, "TERMINAL_OUT_OF_SCOPE");
        }
        if (!valid(raw)) return fail(422, "INVALID_COMMAND");
        Command command = normalize(raw,actor.workCode()!=null && raw.action()==Action.SAVE_BASKET);
        Receipt receipt = ledger.receipts.get(command.requestId());
        if (receipt != null) {
            if (!receipt.actor().equals(actor)) return fail(403, "COMMAND_ACTOR_MISMATCH");
            return receipt.command().equals(command) ? ok(receipt.result()) : fail(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedRevision() != ledger.revision) return fail(409, "STALE_REVISION");
        if (command.action() != Action.DELETE_UNFINISHED && ledger.seed.mode() != Mode.BASKET) {
            return fail(403, "BASKET_NOT_AVAILABLE");
        }
        if (!ledger.work.keySet().containsAll(command.visible())) return fail(404, "WORK_NOT_FOUND");

        return switch (command.action()) {
            case SAVE_BASKET -> save(ledger, actor, command);
            case START_BASKET -> start(ledger, actor, command);
            case DELETE_UNFINISHED, DELETE_ROW -> delete(ledger, actor, command);
            case PAUSE_BASKET, RESUME_BASKET, FINISH_BASKET -> transition(ledger,actor,command);
            case CLEAR_BASKET_ISSUES, CLEAR_BASKET_RETURNS -> clearMaterials(ledger, actor, command);
            case SET_RETURN_QUANTITY -> setReturnQuantity(ledger, actor, command);
            case ADD_MANUAL_ISSUE -> addManualIssue(ledger,actor,command,queried);
            case REMOVE_ISSUE_ROWS, REMOVE_RETURN_ROWS -> removeMaterialRows(ledger,actor,command);
        };
    }

    private Reply<Result> addManualIssue(Ledger ledger,Actor actor,Command command,Set<Lot> queried) {
        var work=ledger.work.get(command.visible().get(0));
        if(work.phase()!=Phase.BASKETED && work.phase()!=Phase.STARTED || !command.groupId().equals(work.groupId()))
            return fail(409,"BASKET_REQUIRED");
        var group=ledger.groups.get(work.groupId());
        if(group==null || !group.terminal().equals(actor.terminal()))return fail(403,"GROUP_TERMINAL_MISMATCH");
        var issue=command.issues().get(0);
        int sequence=command.manualSequence();
        Issue parent=null;
        if(sequence>0){
            if(group.startedAt()==null && group.issueSequences().contains(sequence))parent=group.issues().get(group.issueSequences().indexOf(sequence));
            else if(group.startedAt()!=null)parent=group.productionIssues().stream().filter(p->p.sequence()==command.manualSequence())
                    .map(ProductionIssue::line).findFirst().orElse(null);
            if(parent==null || !parent.lot().equals(issue.lot()))return fail(422,"ISSUE_SEQUENCE_NOT_FOUND");
        }
        if(queried.isEmpty() || !queried.contains(issue.lot()) && (parent==null || parent.quantity().compareTo(issue.quantity())!=0))
            return fail(403,"STOCK_SELECTION_REQUIRED");
        var available=ledger.seed.stock().getOrDefault(issue.lot(),ZERO).subtract(reservations(ledger,Set.of()).getOrDefault(issue.lot(),ZERO));
        if(queried.contains(issue.lot()) && issue.quantity().compareTo(available)>0)return fail(409,"INSUFFICIENT_MATERIAL");
        if(sequence==0)sequence=group.productionIssues().stream().mapToInt(ProductionIssue::sequence).max().orElse(0)+1;
        else if(group.productionIssues().stream().anyMatch(p->p.sequence()==command.manualSequence()))return fail(409,"ISSUE_SEQUENCE_CONFLICT");
        var entries=new ArrayList<>(group.productionIssues());
        entries.add(new ProductionIssue(sequence,issue,actor.worker(),clock.instant()));
        ledger.groups.put(group.id(),new Group(group.id(),group.terminal(),group.issues(),group.returns(),group.startedAt(),
                group.savedDate(),group.productionReturns(),entries,group.issueSequences(),group.returnSequences()));
        return commit(ledger,actor,command,List.of(),group.id());
    }

    private Reply<Result> clearMaterials(Ledger ledger, Actor actor, Command command) {
        Work row = ledger.work.get(command.visible().get(0));
        if (row.phase() != Phase.BASKETED || !command.groupId().equals(row.groupId())) return fail(409, "BASKET_REQUIRED");
        Group group = ledger.groups.get(row.groupId());
        if (group == null || !group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
        if (group.startedAt() != null) return fail(409, "WORK_ALREADY_STARTED");
        boolean clearIssues = command.action() == Action.CLEAR_BASKET_ISSUES;
        if (clearIssues ? group.issues().isEmpty() : group.returns().isEmpty()) return fail(409, "MATERIAL_LIST_EMPTY");
        var remaining = new Group(group.id(), group.terminal(), clearIssues ? List.of() : group.issues(),
                clearIssues ? group.returns() : List.of(), null, group.savedDate(), List.of(),group.productionIssues(),
                clearIssues ? List.of() : group.issueSequences(), clearIssues ? group.returnSequences() : List.of());
        if (!remaining.issues().isEmpty() || !remaining.returns().isEmpty()) {
            ledger.groups.put(group.id(), remaining);
            return commit(ledger, actor, command, List.of(), group.id());
        }
        var keys = members(ledger, group.id()).stream().sorted(KEY_ORDER).toList();
        ledger.groups.remove(group.id());
        setPhase(ledger, keys, Phase.READY, null);
        return commit(ledger, actor, command, keys, null);
    }

    private Reply<Result> save(Ledger ledger, Actor actor, Command command) {
        Set<String> replacing = new HashSet<>();
        for (PlanKey key : command.selected()) {
            Work row = ledger.work.get(key);
            if (row.phase() != Phase.READY && row.phase() != Phase.BASKETED) return fail(409, "WORK_ALREADY_STARTED");
            if (row.groupId() != null) {
                Group group = ledger.groups.get(row.groupId());
                if (!group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
                replacing.add(group.id());
            }
        }
        for (String id : replacing) {
            if (!command.selected().containsAll(members(ledger, id))) return fail(409, "GROUP_REPLACE_REQUIRES_ALL");
        }
        if (command.returns().stream().anyMatch(row -> !ledger.seed.returnCandidates().contains(row.lot()))) {
            return fail(422, "RETURN_LOCATION_NOT_ALLOWED");
        }
        var reserved = reservations(ledger, replacing);
        for (Issue row : command.issues()) {
            BigDecimal available = ledger.seed.stock().get(row.lot());
            if (available == null) return fail(422, "ISSUE_LOT_NOT_FOUND");
            if (available.subtract(reserved.getOrDefault(row.lot(), ZERO)).compareTo(row.quantity()) < 0) {
                return fail(409, "INSUFFICIENT_MATERIAL");
            }
        }

        long sequence = ledger.sequence + 1;
        while (ledger.groups.containsKey("BASKET-DEMO-" + sequence)) sequence++;
        String id = "BASKET-DEMO-" + sequence;
        ledger.sequence = sequence;
        replacing.forEach(ledger.groups::remove);
        ledger.groups.put(id, new Group(id, actor.terminal(), command.issues(), command.returns(), null,
                LocalDate.now(clock), List.of()));
        setPhase(ledger, command.selected(), Phase.BASKETED, id);
        return commit(ledger, actor, command, command.selected(), id);
    }

    private Reply<Result> start(Ledger ledger, Actor actor, Command command) {
        Work first = ledger.work.get(command.visible().get(0));
        String id = first.groupId();
        if (id == null || command.visible().stream().map(ledger.work::get)
                .anyMatch(row -> row.phase() != Phase.BASKETED || !id.equals(row.groupId()))) {
            return fail(409, "BASKET_REQUIRED");
        }
        if (!command.visible().containsAll(members(ledger, id))) return fail(409, "START_REQUIRES_WHOLE_GROUP");
        Group group = ledger.groups.get(id);
        if (!group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
        var startedAt = clock.instant();
        var returns = new ArrayList<ProductionReturn>();
        for (ReturnLine row : group.returns()) {
            returns.add(new ProductionReturn(group.returnSequences().get(returns.size()), row, materialSpecs.get(row.lot()),
                    group.savedDate(), actor.worker(), startedAt, null, null));
        }
        var issues = new ArrayList<ProductionIssue>();
        for(var issue:group.issues())issues.add(new ProductionIssue(group.issueSequences().get(issues.size()),issue,actor.worker(),startedAt));
        var started = new Group(id, group.terminal(), group.issues(), group.returns(), startedAt, group.savedDate(), returns,issues,group.issueSequences(),group.returnSequences());
        ledger.groups.put(id, started);
        setPhase(ledger, command.visible(), Phase.STARTED, id);
        return commit(ledger, actor, command, command.visible(), id);
    }

    private Reply<Result> transition(Ledger ledger,Actor actor,Command command) {
        var amounts=new HashMap<PlanKey,BigDecimal>();
        for(var row:command.amounts()){
            if(row==null || row.quantity()==null || row.quantity().signum()<0 || row.quantity().stripTrailingZeros().scale()>3
                    || row.quantity().precision()>12 || amounts.put(row.key(),row.quantity())!=null) return fail(422,"INVALID_COMMAND");
        }
        boolean finishing=command.action()==Action.FINISH_BASKET;
        if(finishing && !amounts.keySet().equals(new HashSet<>(command.visible())))return fail(422,"INVALID_COMMAND");
        var next=finishing?Phase.COMPLETED:(command.action()==Action.PAUSE_BASKET?Phase.PAUSED:Phase.STARTED);
        for(var key:command.visible()){
            var row=ledger.work.get(key);var group=ledger.groups.get(row.groupId());
            if(group==null || !group.terminal().equals(actor.terminal()))return fail(409,"BASKET_REQUIRED");
            boolean allowed=finishing?row.phase()==Phase.STARTED
                    :row.phase()==(next==Phase.PAUSED?Phase.STARTED:Phase.PAUSED);
            if(!allowed)return fail(409,"INVALID_WORK_PHASE");
            if(!command.visible().containsAll(members(ledger,group.id())))return fail(409,"START_REQUIRES_WHOLE_GROUP");
        }
        for(var key:command.visible()){
            var row=ledger.work.get(key);
            ledger.work.put(key,new Work(row.plan(),next,row.groupId(),finishing?amounts.get(key):row.produced()));
        }
        return commit(ledger,actor,command,command.visible(),null);
    }
    private Reply<Result> setReturnQuantity(Ledger ledger, Actor actor, Command command) {
        var group = ledger.groups.get(command.groupId());
        if (group == null) return fail(404, "GROUP_NOT_FOUND");
        if (!group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
        var visible = command.visible().stream().map(ledger.work::get).toList();
        if (visible.stream().anyMatch(row -> row.phase() == Phase.COMPLETED)) return fail(409, "COMPLETED_IN_LIST");
        if (group.startedAt() == null || visible.stream().noneMatch(row ->
                group.id().equals(row.groupId()) && (row.phase() == Phase.STARTED || row.phase() == Phase.PAUSED))) return fail(409, "ACTIVE_GROUP_REQUIRED");
        if (ledger.seed.returnCandidates().isEmpty()) return fail(409, "RETURN_WAREHOUSE_REQUIRED");
        var edit = command.returnEdit();
        if (group.productionReturns().stream().noneMatch(row -> row.sequence() == edit.sequence())) {
            return fail(404, "RETURN_LINE_NOT_FOUND");
        }
        var now = clock.instant();
        var rows = new ArrayList<ProductionReturn>();
        for (ProductionReturn previous : group.productionReturns()) {
            var spec = previous.material();
            var line = previous.line();
            if (spec == null || spec.width() == null || spec.width().signum() == 0
                    || spec.thickness() == null || spec.thickness().signum() == 0 || line.length().signum() == 0) {
                return fail(422, "RETURN_DIMENSIONS_REQUIRED");
            }
            if (previous.sequence() == edit.sequence()) line = new ReturnLine(line.lot(), edit.quantity(), line.length());
            rows.add(new ProductionReturn(previous.sequence(), line, spec, previous.outputDate(), previous.createdBy(),
                    previous.createdAt(), actor.worker(), now));
        }
        ledger.groups.put(group.id(), new Group(group.id(), group.terminal(), group.issues(), group.returns(),
                group.startedAt(), group.savedDate(), rows,group.productionIssues(),group.issueSequences(),group.returnSequences()));
        return commit(ledger, actor, command, List.of(), group.id());
    }

    private Reply<Result> removeMaterialRows(Ledger ledger,Actor actor,Command command) {
        var visible=command.visible().stream().map(ledger.work::get).toList();
        if(visible.stream().anyMatch(row->row.phase()==Phase.COMPLETED))return fail(409,"COMPLETED_IN_LIST");
        var group=ledger.groups.get(command.groupId());
        if(group==null || visible.stream().noneMatch(row->group.id().equals(row.groupId())
                && (row.phase()==Phase.BASKETED || row.phase()==Phase.STARTED)))return fail(409,"BASKET_REQUIRED");
        if(!group.terminal().equals(actor.terminal()))return fail(403,"GROUP_TERMINAL_MISMATCH");
        boolean issue=command.action()==Action.REMOVE_ISSUE_ROWS, running=group.startedAt()!=null;
        var removal=command.removal();
        if(issue && removal.checked().size()==removal.rows().size())return fail(409,"LAST_ISSUE_REQUIRED");
        var sequences=removal.checked().stream().map(removal.rows()::get).collect(Collectors.toSet());
        // Newly merged parent rows keep mat_seq=0 until the next native grid query.
        sequences.remove(0);
        var issueSeq=group.issueSequences();var returnSeq=group.returnSequences();
        var issues=group.issues();var returns=group.returns();
        var prodIssues=group.productionIssues();var prodReturns=group.productionReturns();
        var keys=issue?(running?prodIssues.stream().map(ProductionIssue::sequence).toList():issueSeq)
                :(running?prodReturns.stream().map(ProductionReturn::sequence).toList():returnSeq);
        // A one-tab ComBasketAdd clear leaves the parent's previously bound rows on screen.
        // The original keyed DELETE succeeds with zero affected records in this case.
        if(!keys.isEmpty() && removal.rows().stream().anyMatch(seq->seq>0 && !keys.contains(seq)))return fail(409,"MATERIAL_ROW_CHANGED");
        sequences.retainAll(keys);
        if(!issue)for(var seq:sequences){
            var line=running?prodReturns.get(keys.indexOf(seq)).line():returns.get(keys.indexOf(seq));
            if("013".equals(line.lot().warehouse()))return fail(422,"SCRAP_RETURN_PROTECTED");
        }
        if(running){
            if(issue)prodIssues=prodIssues.stream().filter(row->!sequences.contains(row.sequence())).toList();
            else prodReturns=prodReturns.stream().filter(row->!sequences.contains(row.sequence())).toList();
        }else{
            var keep=keys.stream().filter(seq->!sequences.contains(seq)).toList();
            if(issue){issues=keep.stream().map(seq->group.issues().get(keys.indexOf(seq))).toList();issueSeq=keep;}
            else {returns=keep.stream().map(seq->group.returns().get(keys.indexOf(seq))).toList();returnSeq=keep;}
        }
        ledger.groups.put(group.id(),new Group(group.id(),group.terminal(),issues,returns,group.startedAt(),group.savedDate(),
                prodReturns,prodIssues,issueSeq,returnSeq));
        return commit(ledger,actor,command,List.of(),group.id());
    }

    private Reply<Result> delete(Ledger ledger, Actor actor, Command command) {
        if (command.visible().stream().map(ledger.work::get).anyMatch(row -> row.phase() == Phase.COMPLETED)) {
            return fail(409, "COMPLETED_IN_LIST");
        }
        List<PlanKey> keys = command.action()==Action.DELETE_ROW || ledger.seed.mode() == Mode.CHECKED_LIST ? command.selected() : command.visible();
        if (keys.isEmpty()) return fail(422, "SELECTION_REQUIRED");
        List<PlanKey> persisted = keys.stream().filter(key -> ledger.work.get(key).phase() != Phase.READY).toList();
        if (persisted.isEmpty()) return fail(409, "NO_PERSISTED_WORK");
        Set<String> touched = new HashSet<>();
        for (PlanKey key : persisted) {
            String id = ledger.work.get(key).groupId();
            Group group = ledger.groups.get(id);
            if (group == null || !group.terminal().equals(actor.terminal())) {
                return fail(403, "GROUP_TERMINAL_MISMATCH");
            }
            touched.add(id);
        }
        setPhase(ledger, persisted, Phase.READY, null);
        for (String id : touched) {
            if (members(ledger, id).isEmpty()) ledger.groups.remove(id);
        }
        return commit(ledger, actor, command, keys, null);
    }

    private static void setPhase(Ledger ledger, List<PlanKey> keys, Phase phase, String groupId) {
        keys.forEach(key -> ledger.work.put(key, new Work(ledger.work.get(key).plan(), phase, groupId)));
    }

    private static Set<PlanKey> members(Ledger ledger, String groupId) {
        return ledger.work.values().stream().filter(row -> groupId.equals(row.groupId())).map(row -> row.plan().key())
                .collect(Collectors.toSet());
    }

    private static Map<Lot, BigDecimal> reservations(Ledger ledger, Set<String> excluding) {
        Map<Lot, BigDecimal> reserved = new HashMap<>();
        ledger.groups.forEach((id, group) -> {
            if (!excluding.contains(id)) group.issues().forEach(row -> reserved.merge(row.lot(), row.quantity(), BigDecimal::add));
        });
        return reserved;
    }

    private static Reply<Result> commit(Ledger ledger, Actor actor, Command command, List<PlanKey> keys, String id) {
        Result result = new Result(++ledger.revision, keys, id);
        ledger.receipts.put(command.requestId(), new Receipt(actor, command, result));
        return ok(result);
    }

    private static boolean valid(Command command) {
        if (command == null || command.action() == null || blank(command.requestId()) || command.requestId().length() > 128
                || command.expectedRevision() == null || command.expectedRevision() < 0
                || command.visible().isEmpty() || command.visible().size() > 100 || command.issues().size() > 100
                || command.returns().size() > 100 || !validKeys(command.visible()) || !validKeys(command.selected())
                || !command.visible().containsAll(command.selected())) return false;
        if(command.action()!=Action.FINISH_BASKET && !command.amounts().isEmpty()) return false;
        if(command.action()!=Action.ADD_MANUAL_ISSUE && command.manualSequence()!=null)return false;
        if(command.action()==Action.REMOVE_ISSUE_ROWS || command.action()==Action.REMOVE_RETURN_ROWS){
            var r=command.removal();
            return r!=null && !blank(command.groupId()) && command.selected().isEmpty() && command.issues().isEmpty()
                    && command.returns().isEmpty() && command.returnEdit()==null && !r.checked().isEmpty()
                    && r.rows().size()<=500 && r.rows().stream().allMatch(n->n>=0)
                    && r.rows().stream().filter(n->n>0).distinct().count()==r.rows().stream().filter(n->n>0).count()
                    && r.checked().stream().allMatch(n->n>=0 && n<r.rows().size())
                    && r.checked().stream().distinct().count()==r.checked().size();
        }
        if(command.removal()!=null)return false;
        if(command.action()==Action.DELETE_ROW && command.selected().size()!=1) return false;
        if (command.action() == Action.SET_RETURN_QUANTITY) {
            var edit = command.returnEdit();
            if (edit == null || edit.quantity() == null || edit.sequence() <= 0) return false;
            var quantity = edit.quantity().stripTrailingZeros();
            return !blank(command.groupId()) && command.selected().isEmpty() && command.issues().isEmpty()
                    && command.returns().isEmpty() && quantity.signum() >= 0 && quantity.scale() <= 6
                    && quantity.compareTo(BigDecimal.valueOf(99999999)) <= 0 && quantity.toPlainString().length() <= 8;
        }
        if (command.returnEdit() != null) return false;
        if (command.action()==Action.ADD_MANUAL_ISSUE)
            return command.manualSequence()!=null && command.manualSequence()>=0 && !blank(command.groupId()) && command.selected().isEmpty() && command.visible().size()==1 && command.returns().isEmpty()
                    && command.issues().size()==1 && valid(command.issues().get(0).lot()) && amount(command.issues().get(0).quantity());
        if (command.action() == Action.SAVE_BASKET) {
            return !command.selected().isEmpty() && !command.issues().isEmpty()
                    && command.issues().stream().allMatch(row -> valid(row.lot()) && amount(row.quantity()))
                    && command.returns().stream().allMatch(row -> valid(row.lot()) && amount(row.quantity()) && amount(row.length()));
        }
        if (command.action() == Action.CLEAR_BASKET_ISSUES || command.action() == Action.CLEAR_BASKET_RETURNS) {
            return !blank(command.groupId()) && command.visible().size() == 1 && command.selected().isEmpty()
                    && command.issues().isEmpty() && command.returns().isEmpty();
        }
        return command.issues().isEmpty() && command.returns().isEmpty()
                && (command.action() != Action.START_BASKET || command.selected().isEmpty());
    }

    private static boolean validKeys(List<PlanKey> keys) {
        return keys.stream().allMatch(key -> key.date() != null && key.sequence() > 0)
                && new HashSet<>(keys).size() == keys.size();
    }

    private static Command normalize(Command command,boolean gridOrder) {
        Map<Lot, BigDecimal> totals = new java.util.LinkedHashMap<>();
        command.issues().forEach(line -> totals.merge(line.lot(), line.quantity().setScale(3), BigDecimal::add));
        var entries=totals.entrySet().stream();
        var returnRows=command.returns().stream().map(row -> new ReturnLine(row.lot(),row.quantity().setScale(3),row.length().setScale(3)));
        if(!gridOrder){
            entries=entries.sorted(Map.Entry.comparingByKey(LOT_ORDER));
            returnRows=returnRows.sorted(Comparator.comparing(ReturnLine::lot, LOT_ORDER).thenComparing(ReturnLine::length)
                    .thenComparing(ReturnLine::quantity));
        }
        var issues=entries.map(entry -> new Issue(entry.getKey(), entry.getValue())).toList();
        var returns=returnRows.toList();
        return new Command(command.action(), command.requestId(), command.expectedRevision(),
                command.visible().stream().sorted(KEY_ORDER).toList(),
                command.selected().stream().sorted(KEY_ORDER).toList(), issues, returns, command.groupId(), command.returnEdit(),command.amounts(),command.manualSequence(),command.removal());
    }

    private static boolean amount(BigDecimal value) {
        return value != null && value.signum() > 0 && value.compareTo(MAX) <= 0 && value.stripTrailingZeros().scale() <= 3;
    }

    private static boolean valid(Actor actor) {
        return actor != null && actor.scope() != null && !blank(actor.terminal()) && !blank(actor.worker());
    }

    private static boolean valid(Lot lot) {
        return lot != null && !blank(lot.item()) && !blank(lot.lot()) && !blank(lot.warehouse()) && !blank(lot.position());
    }

    private static boolean allowed(Ledger ledger, Actor actor) {
        return ledger != null && ledger.seed.terminals().containsKey(actor.terminal());
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static <T> Reply<T> ok(T value) { return new Reply<>(200, null, value); }
    private static <T> Reply<T> fail(int status, String error) { return new Reply<>(status, error, null); }
}
