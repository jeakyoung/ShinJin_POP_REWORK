package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import com.shinjin.pop.admin.TerminalSettingsDemoController.LotPolicy;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("demo")
public class WorkOrderFixtures {
    enum State { WAITING, IN_PROGRESS, PAUSED, COMPLETE }

    private static final java.util.ResourceBundle COLUMNS = java.util.ResourceBundle.getBundle(
            "demo.work-order-columns", java.util.Locale.ROOT);

    record Display(String customer, String deliveryDate, String quality, String thickness, String width, String length) {}

    record Summary(LocalDate planDate, int planSequence, String orderNumber, int orderLine,
            String itemName, String process, BigDecimal plannedQuantity, State status, Display display) {
        Summary(LocalDate planDate, int planSequence, String orderNumber, int orderLine,
                String itemName, String process, BigDecimal plannedQuantity, State status) {
            this(planDate, planSequence, orderNumber, orderLine, itemName, process, plannedQuantity, status, null);
        }
        private String column(String name) {
            var key = orderNumber + "." + orderLine + "." + name;
            return COLUMNS.containsKey(key) ? COLUMNS.getString(key) : null;
        }
        public Display getDisplay() {
            if (display != null) return display;
            return new Display(column("customer_name"), column("delivery_date"), column("mat_quaname"),
                    column("thickness"), column("spec_x"), column("spec_y"));
        }
    }

    record Step(String name, State status) {}

    record Position(String warehouse, String location) {}
    record StockPosition(Position position, BigDecimal availableQuantity) {}
    record Material(String lotCode, BigDecimal issuedQuantity, List<StockPosition> positions) {}
    record MaterialSpec(String quality,BigDecimal thickness,BigDecimal width,BigDecimal length) {}
    record MaterialEvent(Action action, String lotCode, BigDecimal quantity, Position position,
            String workerId, long revision,MaterialSpec spec) {}

    record Detail(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy,
            String completedBy, long revision, List<Material> materials, Position returnPosition, List<MaterialEvent> materialEvents) {}

    private record Order(Summary plan, List<Step> steps, BigDecimal actualQuantity, String startedBy, String completedBy, long revision,
            Map<String, BigDecimal> issued, List<MaterialEvent> events) {
        Order(Summary plan, List<Step> steps) {
            this(plan, steps, null, null, null, 0, Map.of(), List.of());
        }
    }

    enum Action { START, PAUSE, RESUME, CANCEL_START, COMPLETE, ISSUE_MATERIAL, RETURN_MATERIAL }

    private record ScopedPlan(String terminalId, Order order) {}

    private static final LocalDate PLAN_DATE = LocalDate.of(2026, 11, 25);

    private Inventory inventory = new Inventory(List.of(
            new ScopedPlan("DEMO-A", new Order(
                    new Summary(PLAN_DATE, 101, "DEMO-ORDER-11", 1, "샘플 강판 A", "절단",
                            new BigDecimal("12.5"), State.WAITING),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.WAITING)))),
            new ScopedPlan("DEMO-A", new Order(
                    new Summary(PLAN_DATE, 102, "DEMO-ORDER-12", 2, "샘플 강판 B", "절단",
                            new BigDecimal("8"), State.IN_PROGRESS),
                    List.of(new Step("소재 준비", State.COMPLETE), new Step("절단", State.IN_PROGRESS)))),
            new ScopedPlan("DEMO-B", new Order(
                    new Summary(PLAN_DATE, 201, "DEMO-ORDER-21", 1, "샘플 제품 C", "포장",
                            new BigDecimal("4"), State.WAITING),
                    List.of(new Step("가공 확인", State.COMPLETE), new Step("포장", State.WAITING))))), initialStock());

    private record Lot(String terminalId, String code, Position position) {}
    private record Inventory(List<ScopedPlan> plans, Map<Lot, BigDecimal> stock) {}
    record BatchRow(LocalDate date,int sequence,long revision,BigDecimal good,BigDecimal arrangement,GoodProductLocations.Codes goodPlace) {}
    record Focus(LocalDate date,int sequence) {}
    record Batch(String requestId,Action action,List<BatchRow> selected,Boolean autoPrint,List<BatchRow> visible,List<ProductionMaterials.Draft> materialDrafts,Focus focus,List<ScannedIssue> scannedIssues) {}
    record ScannedIssue(LocalDate date,int sequence,String warehouse,String location,String lot,String material,BigDecimal quantity,Integer slot,String source) {}
    private record BatchReceipt(String actor,Batch command) {}
    private record ClockEntry(java.time.Instant started,String group) {}
    private final Map<String,ClockEntry> starts=new HashMap<>();
    private final Map<String,BatchReceipt> batches=new HashMap<>();
    private final Map<String,BigDecimal> arrangements=new HashMap<>();
    private final Map<String,GoodProductLocations.Place> goodPlaces=new HashMap<>();
    private final WorkDefects defects=new WorkDefects();
    private final Map<String,ProductionMaterials.Receipt> materialReceipts=new HashMap<>();
    private final ProductionCatalog production;
    WorkOrderFixtures(ProductionCatalog catalog) {
        this.production=catalog;
        var stock=new HashMap<>(inventory.stock());
        for(var row:catalog.stock()){
            var lot=new Lot(row.terminal(),row.lot(),new Position(row.warehouse(),row.location()));
            if(row.quantity()==null||row.quantity().signum()<0||stock.putIfAbsent(lot,row.quantity())!=null)
                throw new IllegalArgumentException("Duplicate or invalid synthetic production stock");
        }
        inventory=new Inventory(inventory.plans(),Map.copyOf(stock));
        for (var scoped : inventory.plans()) {
            var plan = scoped.order().plan();
            var place = production.goodProducts.initial(scoped.terminalId(), plan.planDate(), plan.planSequence());
            if (place != null) goodPlaces.put(workKey(scoped), place);
        }
        for(var row:catalog.starts())starts.put(key(row.terminal(),row.date(),row.sequence()),new ClockEntry(row.time(),row.group()));
    }
    private static String key(String terminal,LocalDate date,int seq){return terminal+"/"+date+"/"+seq;}
    record ProductionRow(LocalDate date,int sequence,BigDecimal produced,BigDecimal bad,BigDecimal arrangement,BigDecimal remaining,java.time.Instant started,String group,long revision,GoodProductLocations.Place goodPlace) {}
    synchronized List<ProductionRow> productionRows(String terminal){
        return inventory.plans().stream().filter(r->r.terminalId().equals(terminal)).map(r->{
            var s=r.order().plan();var k=key(terminal,s.planDate(),s.planSequence());var h=starts.get(k);
            var remaining=production.remaining(terminal,s);
            if(remaining!=null && s.status()==State.COMPLETE && r.order().actualQuantity()!=null)remaining=remaining.subtract(r.order().actualQuantity());
            return new ProductionRow(s.planDate(),s.planSequence(),r.order().actualQuantity(),defects.get(k).total(),arrangements.get(k),remaining,h==null?null:h.started(),h==null?null:h.group(),r.order().revision(),goodPlaces.get(k));
        }).toList();
    }
    synchronized GoodProductLocations.View goodLocations(String terminal, LocalDate date, int sequence, List<String> allowed) {
        var order = find(terminal, date, sequence);
        if (order.order().plan().status() == State.COMPLETE) throw new IllegalStateException("WORK_CHANGED");
        return new GoodProductLocations.View(production.goodProducts.choices(terminal, date, sequence, allowed), goodPlaces.get(workKey(order)), order.order().revision());
    }
    synchronized void processBatch(String terminal,String worker,Batch cmd,ProductionCatalog.Terminal cfg,java.util.function.Supplier<LotPolicy> policy,java.util.function.Function<ScannedIssue,ProcessLotLookup.Candidate> validateScan,java.util.function.Predicate<BatchRow> confirmedGoodPlace) {
        var before=inventory;
        try{applyBatch(terminal,worker,cmd,cfg,policy,validateScan,confirmedGoodPlace);}catch(RuntimeException e){inventory=before;throw e;}
    }
    private void applyBatch(String terminal,String worker,Batch cmd,ProductionCatalog.Terminal cfg,java.util.function.Supplier<LotPolicy> policy,java.util.function.Function<ScannedIssue,ProcessLotLookup.Candidate> validateScan,java.util.function.Predicate<BatchRow> confirmedGoodPlace) {
        if(cmd==null || cmd.requestId()==null || cmd.requestId().isBlank() || cmd.requestId().length()>128
            || cmd.action()==null || !java.util.Set.of(Action.START,Action.COMPLETE,Action.PAUSE,Action.RESUME).contains(cmd.action())
            || cmd.selected()==null || cmd.selected().isEmpty() || cmd.selected().size()>100 || cmd.selected().stream().anyMatch(r->r==null||r.date()==null))throw new IllegalArgumentException("INVALID_COMMAND");
        var actor=terminal+"/"+worker;var previous=batches.get(cmd.requestId());
        if(previous!=null){if(!previous.actor().equals(actor) || !previous.command().equals(cmd))throw new IllegalStateException("REQUEST_ID_REUSED");return;}
        if(cmd.materialDrafts()!=null && !cmd.materialDrafts().isEmpty()){
            if(cmd.action()!=Action.START || cmd.materialDrafts().size()>100 || cmd.selected().stream().anyMatch(row->find(terminal,row.date(),row.sequence()).order().plan().status()!=State.WAITING))throw new IllegalArgumentException("INVALID_COMMAND");
            for(var draft:cmd.materialDrafts()){
                if(draft==null||draft.lines()==null||draft.lines().isEmpty()||draft.lines().size()>100 ||
                    (draft.action()!=Action.ISSUE_MATERIAL&&draft.action()!=Action.RETURN_MATERIAL) ||
                    cmd.focus()!=null&&(!cmd.focus().date().equals(draft.date())||cmd.focus().sequence()!=draft.sequence()) ||
                    cmd.selected().stream().noneMatch(s->s.date().equals(draft.date())&&s.sequence()==draft.sequence()))throw new IllegalArgumentException("INVALID_COMMAND");
                var owner=find(terminal,draft.date(),draft.sequence());
                if(owner.order().plan().status()!=State.WAITING)throw new IllegalStateException("WORK_CHANGED");
                inventory=applyMaterialRows(inventory,terminal,List.of(owner),draft.lines(),draft.action(),false,false,worker);
            }
        }
        if(cmd.scannedIssues()!=null&&!cmd.scannedIssues().isEmpty()){
            if(cmd.action()!=Action.START||cmd.scannedIssues().size()>100||cmd.focus()==null
                    ||cmd.selected().stream().anyMatch(row->find(terminal,row.date(),row.sequence()).order().plan().status()!=State.WAITING))
                throw new IllegalArgumentException("INVALID_COMMAND");
            if(cfg.issue().isEmpty())throw new IllegalStateException("INPUT_WAREHOUSE_REQUIRED");
            var focus=find(terminal,cmd.focus().date(),cmd.focus().sequence());
            if(cmd.selected().stream().noneMatch(row->row.date().equals(cmd.focus().date())&&row.sequence()==cmd.focus().sequence()))
                throw new IllegalArgumentException("INVALID_COMMAND");
            var source=focus.order();
            var stock=new HashMap<>(inventory.stock());
            var seen=new java.util.HashSet<List<String>>();
            for(var issue:cmd.scannedIssues()){
                if(issue==null||!cmd.focus().date().equals(issue.date())||cmd.focus().sequence()!=issue.sequence()
                        ||issue.lot()==null||issue.material()==null||issue.warehouse()==null||issue.location()==null
                        ||issue.quantity()==null||issue.quantity().compareTo(BigDecimal.ONE)<0||issue.quantity().stripTrailingZeros().scale()>0
                        ||!seen.add(List.of(issue.lot(),issue.material(),issue.warehouse(),issue.location())))throw new IllegalArgumentException("INVALID_COMMAND");
                source=issueFromPicker(terminal,worker,source,issue,validateScan,stock,policy.get(),focus.order().revision());
            }
            var plans=new ArrayList<>(inventory.plans());plans.set(plans.indexOf(focus),new ScopedPlan(terminal,source));
            inventory=new Inventory(List.copyOf(plans),Map.copyOf(stock));
        }
        var shown=batchRows(terminal,cmd.visible()==null?cmd.selected():cmd.visible());
        var selected=batchRows(terminal,cmd.selected());
        if(!shown.keySet().containsAll(selected.keySet()))throw new IllegalArgumentException("INVALID_COMMAND");
        if(shown.keySet().stream().anyMatch(r->r.order().plan().status()==State.COMPLETE))throw new IllegalStateException("COMPLETED_IN_LIST");
        var first=shown.keySet().iterator().next();
        var focus=cmd.focus()==null?null:find(terminal,cmd.focus().date(),cmd.focus().sequence());
        if(focus!=null&&!shown.containsKey(focus))throw new IllegalArgumentException("INVALID_COMMAND");
        if(cmd.action()==Action.COMPLETE){
            if(cfg.good().isEmpty())throw new IllegalStateException("GOOD_WAREHOUSE_REQUIRED");
            for(var item:shown.entrySet()){
                if(item.getKey().order().plan().status()==State.WAITING)throw new IllegalStateException("START_ALL_FIRST");
                var amount=item.getValue().good()==null?item.getKey().order().actualQuantity():item.getValue().good();
                if((amount==null||amount.compareTo(BigDecimal.ONE)<0) && defects.get(workKey(item.getKey())).total().compareTo(BigDecimal.ONE)<0)throw new IllegalArgumentException("PRODUCTION_QUANTITY_REQUIRED");
            }
        }
        var rows=new ArrayList<>(inventory.plans());var committedStarts=new HashMap<>(starts);var savedArrangement=new HashMap<>(arrangements);
        var group=selected.keySet().stream().filter(r->r.order().plan().status()!=State.WAITING).map(r->starts.get(workKey(r)))
                .filter(java.util.Objects::nonNull).findFirst().orElse(null);
        boolean starting=cmd.action()==Action.START;
        if(starting && selected.keySet().stream().noneMatch(r->r.order().plan().status()==State.WAITING))throw new IllegalStateException("WORK_CHANGED");
        if(starting && group!=null && focus!=null && focus.order().plan().status()==State.WAITING)throw new IllegalStateException("FOCUS_STARTED_ORDER");
        if(starting && group==null)group=new ClockEntry(java.time.Instant.now(),"G-"+cmd.requestId());
        boolean stopping=cmd.action()==Action.PAUSE || cmd.action()==Action.RESUME;
        if(stopping){
            group=starts.get(workKey(first));
            if(group==null)throw new IllegalStateException("START_ALL_FIRST");
            var wanted=group.group();selected.clear();
            for(var r:inventory.plans())if(r.terminalId().equals(terminal) && starts.containsKey(workKey(r)) && wanted.equals(starts.get(workKey(r)).group())
                    && r.order().plan().status()!=State.COMPLETE)selected.put(r,null);
        }
        var activeGroup=group==null?null:group.group();
        var materialSource=focus==null?shown.keySet().stream().flatMap(s->materialMembers(s).stream()).distinct().toList():materialMembers(focus);
        boolean material=materialSource.stream().anyMatch(r->r.order().events().stream().anyMatch(e->e.action()==Action.ISSUE_MATERIAL)||!r.order().issued().isEmpty());
        if(!material)throw new IllegalStateException("INPUT_MATERIAL_REQUIRED");
        if(starting||cmd.action()==Action.COMPLETE){
            var visibleMaterial=materialSource.stream().flatMap(s->s.order().events().stream()).toList();
            for(var e:visibleMaterial){
                if(e.action()==Action.ISSUE_MATERIAL && cmd.action()==Action.COMPLETE && e.quantity().compareTo(BigDecimal.ONE)<0)throw new IllegalArgumentException("INPUT_QUANTITY_REQUIRED");
                if(e.action()==Action.RETURN_MATERIAL){
                    if(!validDimensions(e.spec()))throw new IllegalArgumentException("RETURN_DIMENSIONS_REQUIRED");
                    if(!"013".equals(e.position().warehouse()) && (e.position().location()==null || e.position().location().isBlank() || cmd.action()==Action.COMPLETE && e.quantity().compareTo(BigDecimal.ONE)<0))throw new IllegalArgumentException("RETURN_ROW_INVALID");
                }
            }
        }
        var savedPlaces = new HashMap<>(goodPlaces);
        for(var item:selected.entrySet()){
            var source=item.getKey();var old=source.order();var value=item.getValue();var k=workKey(source);
            if(starting && old.plan().status()!=State.WAITING)continue;
            if(cmd.action()==Action.COMPLETE && (starts.get(k)==null || !starts.get(k).group().equals(activeGroup)))throw new IllegalStateException("DIFFERENT_GROUP");
            var good=value==null?null:value.good();var batchCount=value==null?null:value.arrangement();
            if ((starting || cmd.action() == Action.COMPLETE) && value != null && value.goodPlace() != null) {
                var choices = production.goodProducts.choices(terminal, value.date(), value.sequence(), cfg.good());
                savedPlaces.put(k, production.goodProducts.resolve(choices, value.goodPlace(), confirmedGoodPlace.test(value)));
            }
            if((starting||cmd.action()==Action.COMPLETE) && batchCount!=null){
                if(batchCount.signum()<0 || batchCount.stripTrailingZeros().scale()>0)throw new IllegalArgumentException("INVALID_ARRANGEMENT");
                savedArrangement.put(k,batchCount);
            }
            if(starting || cmd.action()==Action.COMPLETE){
                if(good==null)good=old.actualQuantity()==null?BigDecimal.ZERO:old.actualQuantity();
                var knownRemaining=production.remaining(terminal,old.plan());
                var cap=knownRemaining==null?old.plan().plannedQuantity():knownRemaining.min(old.plan().plannedQuantity());
                if(good.signum()<0||good.compareTo(cap)>0||good.stripTrailingZeros().scale()>3)throw new IllegalArgumentException("INVALID_QUANTITY");
                if(cmd.action()==Action.COMPLETE && good.compareTo(BigDecimal.ONE)<0 && defects.get(k).total().compareTo(BigDecimal.ONE)<0)throw new IllegalArgumentException("PRODUCTION_QUANTITY_REQUIRED");
            }else good=old.actualQuantity();
            var changed=transition(old,cmd.action(),good,worker,true);
            if(starting)committedStarts.put(k,group);
            rows.set(rows.indexOf(source),new ScopedPlan(terminal,changed));
        }
        goodPlaces.clear();goodPlaces.putAll(savedPlaces);
        starts.clear();starts.putAll(committedStarts);
        arrangements.clear();arrangements.putAll(savedArrangement);
        inventory=new Inventory(List.copyOf(rows),inventory.stock());batches.put(cmd.requestId(),new BatchReceipt(actor,cmd));
    }
    private Order issueFromPicker(String terminal,String worker,Order order,ScannedIssue issue,
            java.util.function.Function<ScannedIssue,ProcessLotLookup.Candidate> validate,Map<Lot,BigDecimal> stock,LotPolicy policy,long resultRevision){
        if(issue.quantity()==null||issue.quantity().compareTo(BigDecimal.ONE)<0||issue.quantity().stripTrailingZeros().scale()>0)
            throw new IllegalArgumentException("INVALID_QUANTITY");
        var candidate=validate.apply(issue);
        var lot=new Lot(terminal,issue.lot(),new Position(issue.warehouse(),issue.location()));
        if(candidate==null||issue.quantity().compareTo(candidate.available())>0||!stock.containsKey(lot))
            throw new IllegalStateException("MATERIAL_CHANGED");
        if(issue.quantity().compareTo(stock.get(lot))>0)throw new IllegalStateException("INSUFFICIENT_STOCK");
        var updated=moveMaterial(terminal,worker,order,Action.ISSUE_MATERIAL,issue.lot(),issue.quantity(),issue.warehouse(),issue.location(),stock,policy);
        var events=new ArrayList<>(updated.events());
        var last=events.remove(events.size()-1);
        events.add(new MaterialEvent(last.action(),last.lotCode(),last.quantity(),last.position(),last.workerId(),last.revision(),
                new MaterialSpec(candidate.quality(),candidate.thickness(),candidate.width(),candidate.length())));
        return new Order(updated.plan(),updated.steps(),updated.actualQuantity(),updated.startedBy(),updated.completedBy(),resultRevision,updated.issued(),List.copyOf(events));
    }
    record ManualIssue(String requestId,long revision,ScannedIssue line) {}
    private record ManualReceipt(String actor,ManualIssue command) {}
    private final Map<String,ManualReceipt> manualReceipts=new HashMap<>();
    synchronized void addManual(String terminal,String worker,LocalDate date,int sequence,ManualIssue cmd,LotPolicy policy,
            java.util.function.Function<ScannedIssue,ProcessLotLookup.Candidate> validate){
        if(cmd==null||cmd.requestId()==null||cmd.requestId().isBlank()||cmd.requestId().length()>128||cmd.line()==null
                ||!date.equals(cmd.line().date())||sequence!=cmd.line().sequence()||!"manual".equals(cmd.line().source())||cmd.line().slot()==null)
            throw new IllegalArgumentException("INVALID_COMMAND");
        var actor=terminal+"/"+worker;
        var receipt=manualReceipts.get(cmd.requestId());
        if(receipt!=null){if(!actor.equals(receipt.actor())||!cmd.equals(receipt.command()))throw new IllegalStateException("REQUEST_ID_REUSED");return;}
        var focus=find(terminal,date,sequence);var old=focus.order();
        if(old.revision()!=cmd.revision())throw new IllegalStateException("WORK_CHANGED");
        if(old.plan().status()!=State.IN_PROGRESS&&old.plan().status()!=State.PAUSED)throw new IllegalStateException("STARTED_WORK_REQUIRED");
        var stock=new HashMap<>(inventory.stock());
        var next=issueFromPicker(terminal,worker,old,cmd.line(),validate,stock,policy,old.revision()+1);
        var plans=new ArrayList<>(inventory.plans());plans.set(plans.indexOf(focus),new ScopedPlan(terminal,next));
        inventory=new Inventory(List.copyOf(plans),Map.copyOf(stock));
        manualReceipts.put(cmd.requestId(),new ManualReceipt(actor,cmd));
    }
    private static String workKey(ScopedPlan source){var p=source.order().plan();return key(source.terminalId(),p.planDate(),p.planSequence());}
    private List<ScopedPlan> materialMembers(ScopedPlan focus) {
        var clock=starts.get(workKey(focus));
        if(clock==null)return List.of(focus);
        return inventory.plans().stream().filter(p->p.terminalId().equals(focus.terminalId()) && starts.containsKey(workKey(p))
                && clock.group().equals(starts.get(workKey(p)).group())).toList();
    }
    synchronized List<ProductionMaterials.Line> materialRows(String terminal,LocalDate date,int sequence){
        var members=materialMembers(find(terminal,date,sequence));
        return members.stream().flatMap(p->p.order().events().stream().map(e->new ProductionMaterials.Line(p.order().plan().planDate(),
                p.order().plan().planSequence(),p.order().revision(),e,inventory.stock().getOrDefault(new Lot(terminal,e.lotCode(),e.position()),BigDecimal.ZERO)))).toList();
    }
    synchronized List<ProductionMaterials.Line> changeMaterials(String terminal,String worker,LocalDate date,int seq,ProductionMaterials.Command cmd) {
        if(cmd==null||cmd.requestId()==null||cmd.requestId().isBlank()||cmd.requestId().length()>128||cmd.lines()==null||cmd.lines().isEmpty()
                ||cmd.lines().size()>100||cmd.visible()==null||cmd.visible().size()>100)throw new IllegalArgumentException("INVALID_COMMAND");
        var focus=key(terminal,date,seq);var receipt=materialReceipts.get(cmd.requestId());
        if(receipt!=null){
            if(!receipt.worker().equals(worker)||!receipt.focus().equals(focus)||!receipt.command().equals(cmd))throw new IllegalStateException("REQUEST_ID_REUSED");
            return receipt.result();
        }
        if(cmd.action()!=Action.ISSUE_MATERIAL && cmd.action()!=Action.RETURN_MATERIAL)throw new IllegalArgumentException("INVALID_COMMAND");
        var record=find(terminal,date,seq);var members=materialMembers(record);
        for(var entry:cmd.visible())if(find(terminal,entry.date(),entry.sequence()).order().plan().status()==State.COMPLETE)throw new IllegalStateException("COMPLETED_IN_LIST");
        if(record.order().plan().status()==State.COMPLETE)throw new IllegalStateException("COMPLETED_IN_LIST");
        if(!cmd.remove() && record.order().plan().status()==State.WAITING)throw new IllegalStateException("STARTED_WORK_REQUIRED");
        inventory=applyMaterialRows(inventory,terminal,members,cmd.lines(),cmd.action(),cmd.remove(),true,worker);
        var result=materialRows(terminal,date,seq);
        materialReceipts.put(cmd.requestId(),new ProductionMaterials.Receipt(worker,focus,cmd,result));
        return result;
    }
    private Inventory applyMaterialRows(Inventory snapshot,String terminal,List<ScopedPlan> members,List<ProductionMaterials.Patch> patches,Action action,boolean remove,boolean bump,String worker){
        var grouped=new LinkedHashMap<ScopedPlan,Map<Long,ProductionMaterials.Patch>>();
        for(var patch:patches){
            if(patch==null)throw new IllegalArgumentException("INVALID_COMMAND");
            var source=members.stream().filter(p->p.order().plan().planDate().equals(patch.date())&&p.order().plan().planSequence()==patch.sequence()).findFirst()
                    .orElseThrow(()->new IllegalStateException("MATERIAL_CHANGED"));
            if(source.order().revision()!=patch.revision())throw new IllegalStateException("WORK_CHANGED");
            if(grouped.computeIfAbsent(source,r->new LinkedHashMap<>()).put(patch.event(),patch)!=null)throw new IllegalArgumentException("INVALID_COMMAND");
        }
        if(!remove && action==Action.RETURN_MATERIAL){
            long all=members.stream().flatMap(r->r.order().events().stream()).filter(e->e.action()==Action.RETURN_MATERIAL).count();
            if(all!=patches.size())throw new IllegalStateException("MATERIAL_CHANGED");
        }
        var rows=new ArrayList<>(snapshot.plans());var stock=new HashMap<>(snapshot.stock());
        for(var part:grouped.entrySet()){
            var source=part.getKey();var old=source.order();var issued=new HashMap<>(old.issued());var updated=new ArrayList<MaterialEvent>();
            int changed=0;
            for(var event:old.events()){
                var p=part.getValue().get(event.revision());
                if(p==null){updated.add(event);continue;}
                if(event.action()!=action)throw new IllegalStateException("MATERIAL_CHANGED");
                if(remove && action==Action.RETURN_MATERIAL && "013".equals(event.position().warehouse()))throw new IllegalStateException("SCRAP_RETURN");
                var next=remove?BigDecimal.ZERO:p.quantity();
                if(next==null||next.signum()<0||next.stripTrailingZeros().scale()>3||!remove&&action==Action.ISSUE_MATERIAL&&next.compareTo(BigDecimal.ONE)<0)throw new IllegalArgumentException("INVALID_QUANTITY");
                var spec=p.spec()==null?event.spec():p.spec();
                if(action==Action.ISSUE_MATERIAL||"013".equals(event.position().warehouse()))spec=event.spec();
                else if(spec!=null)spec=new MaterialSpec(event.spec()==null?null:event.spec().quality(),spec.thickness(),spec.width(),spec.length());
                if(!remove&&action==Action.RETURN_MATERIAL && !validDimensions(spec))throw new IllegalArgumentException("RETURN_DIMENSIONS_REQUIRED");
                var delta=next.subtract(event.quantity());
                if(action==Action.RETURN_MATERIAL)delta=delta.negate();
                var lot=new Lot(terminal,event.lotCode(),event.position());
                stock.merge(lot,delta.negate(),BigDecimal::add);issued.merge(event.lotCode(),delta,BigDecimal::add);
                if(!remove)updated.add(new MaterialEvent(action,event.lotCode(),next,event.position(),worker,event.revision(),spec));
                changed++;
            }
            if(changed!=part.getValue().size())throw new IllegalStateException("MATERIAL_CHANGED");
            if(issued.values().stream().anyMatch(n->n.signum()<0))throw new IllegalStateException("INSUFFICIENT_STOCK");
            issued.values().removeIf(n->n.signum()==0);
            var replacement=new Order(old.plan(),old.steps(),old.actualQuantity(),old.startedBy(),old.completedBy(),old.revision()+(bump?1:0),Map.copyOf(issued),List.copyOf(updated));
            rows.set(rows.indexOf(source),new ScopedPlan(terminal,replacement));
        }
        if(stock.values().stream().anyMatch(n->n.signum()<0))throw new IllegalStateException("INSUFFICIENT_STOCK");
        if(remove&&action==Action.ISSUE_MATERIAL && members.stream().anyMatch(p->p.order().plan().status()!=State.WAITING)){
            var keys=members.stream().map(WorkOrderFixtures::workKey).toList();
            if(rows.stream().filter(p->keys.contains(workKey(p))).flatMap(p->p.order().events().stream()).noneMatch(e->e.action()==Action.ISSUE_MATERIAL))throw new IllegalStateException("LAST_MATERIAL");
        }
        return new Inventory(List.copyOf(rows),Map.copyOf(stock));
    }
    private static boolean validDimensions(MaterialSpec s){return s!=null && s.thickness()!=null && s.thickness().signum()>0 && s.width()!=null && s.width().signum()>0 && s.length()!=null && s.length().signum()>0;}
    private java.util.LinkedHashMap<ScopedPlan,BatchRow> batchRows(String terminal,List<BatchRow> rows) {
        if(rows.isEmpty()||rows.size()>100)throw new IllegalArgumentException("INVALID_COMMAND");
        var result=new java.util.LinkedHashMap<ScopedPlan,BatchRow>();
        for(var row:rows){
            if(row==null||row.date()==null||row.sequence()<1)throw new IllegalArgumentException("INVALID_COMMAND");
            var source=find(terminal,row.date(),row.sequence());
            if(source.order().revision()!=row.revision())throw new IllegalStateException("WORK_CHANGED");
            if(result.put(source,row)!=null)throw new IllegalArgumentException("INVALID_COMMAND");
        }
        return result;
    }
    private ScopedPlan find(String terminal,LocalDate date,int seq) {
        return inventory.plans().stream().filter(r->r.terminalId().equals(terminal)&&r.order().plan().planDate().equals(date)
                && r.order().plan().planSequence()==seq).findFirst().orElseThrow(()->new java.util.NoSuchElementException("WORK_NOT_FOUND"));
    }
    synchronized WorkDefects.View rejections(String terminal,LocalDate date,int seq,ProductionCatalog.Terminal cfg){
        var source=find(terminal,date,seq);
        if(source.order().plan().status()!=State.IN_PROGRESS && source.order().plan().status()!=State.PAUSED)throw new IllegalStateException("STARTED_WORK_REQUIRED");
        if(cfg.bad().isEmpty())throw new IllegalStateException("BAD_WAREHOUSE_REQUIRED");
        return defects.view(workKey(source),source.order().revision(),cfg);
    }
    synchronized WorkDefects.View setRejections(String terminal,String worker,LocalDate date,int seq,WorkDefects.Command cmd,ProductionCatalog.Terminal cfg){
        var k=key(terminal,date,seq);
        var previous=defects.replay(k,worker,cmd);
        if(previous!=null)return previous;
        var current=rejections(terminal,date,seq,cfg);
        if(current.revision()!=cmd.revision())throw new IllegalStateException("WORK_CHANGED");
        var source=find(terminal,date,seq);var o=source.order();
        var saved=defects.apply(k,worker,cmd,cfg);
        var rows=new ArrayList<>(inventory.plans());
        rows.set(rows.indexOf(source),new ScopedPlan(terminal,new Order(o.plan(),o.steps(),o.actualQuantity(),o.startedBy(),o.completedBy(),o.revision()+1,o.issued(),o.events())));
        inventory=new Inventory(List.copyOf(rows),inventory.stock());
        return saved;
    }
    record EntryKey(LocalDate date,int sequence,long revision) {}
    record Removal(String requestId,List<EntryKey> visible,List<EntryKey> selected) {}
    private record RemovalReceipt(String actor, Removal command) {}
    record WithdrawMaterials(long revision,Action action,List<Long> selected) {}
    private final Map<String,RemovalReceipt> removals = new HashMap<>();
    private final Map<String,Map<String,Order>> withdrawn = new HashMap<>();

    synchronized boolean withdraw(String terminal,LocalDate date,int sequence,WithdrawMaterials cmd) {
        if(cmd==null || (cmd.action()!=Action.ISSUE_MATERIAL && cmd.action()!=Action.RETURN_MATERIAL)
                || cmd.selected()==null || cmd.selected().isEmpty())throw new IllegalArgumentException("INVALID_COMMAND");
        var plans=new ArrayList<>(inventory.plans());
        for(int i=0;i<plans.size();i++){
            var entry=plans.get(i);var order=entry.order();
            if(!entry.terminalId().equals(terminal)||!order.plan().planDate().equals(date)||order.plan().planSequence()!=sequence)continue;
            if(order.revision()!=cmd.revision() || order.plan().status()==State.COMPLETE)throw new IllegalStateException("WORK_CHANGED");
            var keep=new ArrayList<>(order.events());
            var stock=new HashMap<>(inventory.stock());
            var issued=new HashMap<>(order.issued());
            for(long selected:cmd.selected()){
                var event=keep.stream().filter(e->e.action()==cmd.action()&&e.revision()==selected).findFirst()
                        .orElseThrow(()->new IllegalStateException("MATERIAL_CHANGED"));
                keep.remove(event);
                var delta=event.action()==Action.ISSUE_MATERIAL?event.quantity():event.quantity().negate();
                if(stock.merge(new Lot(terminal,event.lotCode(),event.position()),delta,BigDecimal::add).signum()<0
                        || issued.merge(event.lotCode(),delta.negate(),BigDecimal::add).signum()<0)throw new IllegalStateException("INSUFFICIENT_STOCK");
            }
            issued.values().removeIf(q->q.signum()==0);
            if(cmd.action()==Action.ISSUE_MATERIAL && order.plan().status()!=State.WAITING && issued.isEmpty())
                throw new IllegalStateException("LAST_MATERIAL");
            var updated=new Order(order.plan(),order.steps(),order.actualQuantity(),order.startedBy(),order.completedBy(),
                    order.revision()+1,Map.copyOf(issued),List.copyOf(keep));
            plans.set(i,new ScopedPlan(terminal,updated));inventory=new Inventory(List.copyOf(plans),Map.copyOf(stock));return true;
        }
        return false;
    }

    synchronized void remove(String terminal,String worker,Removal cmd) {
        if(cmd==null || cmd.requestId()==null || cmd.requestId().isBlank() || cmd.requestId().length()>128
                || cmd.visible()==null || cmd.selected()==null || cmd.selected().isEmpty() || !cmd.visible().containsAll(cmd.selected()))
            throw new IllegalArgumentException("INVALID_COMMAND");
        var actor=terminal+"/"+worker;
        var id=removals.get(cmd.requestId());
        if(id!=null) {
            if(!id.actor().equals(actor) || !id.command().equals(cmd)) throw new IllegalStateException("REQUEST_ID_REUSED");
            return;
        }
        var remaining=new ArrayList<>(inventory.plans());
        var stock=new HashMap<>(inventory.stock());
        var removed=new HashMap<String,Order>();
        Map<Lot,BigDecimal> adjustments=new HashMap<>();
        for(var key:cmd.visible()) {
            var row=remaining.stream().filter(r->r.terminalId().equals(terminal)
                    && r.order().plan().planDate().equals(key.date()) && r.order().plan().planSequence()==key.sequence()).findFirst()
                    .orElseThrow(()->new IllegalStateException("WORK_CHANGED"));
            var order=row.order();
            if(order.revision()!=key.revision() || order.plan().status()==State.COMPLETE) throw new IllegalStateException("WORK_CHANGED");
            if(!cmd.selected().contains(key))continue;
            for(var event:order.events()) {
                var lot=new Lot(terminal,event.lotCode(),event.position());
                adjustments.merge(lot,event.action()==Action.ISSUE_MATERIAL?event.quantity():event.quantity().negate(),BigDecimal::add);
            }
            remaining.remove(row);
            var s=order.plan();
            var waiting=new Summary(s.planDate(),s.planSequence(),s.orderNumber(),s.orderLine(),s.itemName(),s.process(),s.plannedQuantity(),State.WAITING,s.display());
            removed.put(s.planDate()+"/"+s.planSequence(),new Order(waiting,order.steps().stream().map(step->
                    step.name().equals(waiting.process())?new Step(step.name(),State.WAITING):step).toList(),null,null,null,order.revision()+1,Map.of(),List.of()));
        }
        adjustments.forEach((lot,amount)->{if(stock.merge(lot,amount,BigDecimal::add).signum()<0)throw new IllegalStateException("INSUFFICIENT_STOCK");});
        withdrawn.computeIfAbsent(terminal,t->new HashMap<>()).putAll(removed);
        removed.keySet().forEach(k->{String full=terminal+"/"+k;starts.remove(full);defects.clear(full);arrangements.remove(full);goodPlaces.remove(full);});
        inventory=new Inventory(List.copyOf(remaining),Map.copyOf(stock));
        removals.put(cmd.requestId(),new RemovalReceipt(actor,cmd));
    }

    synchronized Optional<Summary> scan(String terminal, LocalDate date, int sequence) {
        var active=inventory.plans().stream().filter(r->r.terminalId().equals(terminal) && r.order().plan().planDate().equals(date)
                && r.order().plan().planSequence()==sequence).map(r->r.order().plan()).findFirst();
        if(active.isPresent())return active;
        var cache=withdrawn.get(terminal);
        var prior=cache==null?null:cache.remove(date+"/"+sequence);
        if(prior==null)return Optional.empty();
        var plans=new ArrayList<>(inventory.plans());
        var initialPlace=production.goodProducts.initial(terminal,date,sequence);
        if(initialPlace!=null)goodPlaces.put(key(terminal,date,sequence),initialPlace);
        plans.add(new ScopedPlan(terminal,prior));inventory=new Inventory(List.copyOf(plans),inventory.stock());
        return Optional.of(prior.plan());
    }

    public synchronized List<synthetic.planning.PlanningDomain.PlanKey> attachPlanned(String terminal,
            String process, List<synthetic.planning.PlanningDomain.Plan> selected) {
        var rows = new ArrayList<>(inventory.plans());
        List<synthetic.planning.PlanningDomain.PlanKey> attached = new ArrayList<>();
        for (var plan : selected) {
            var key = plan.key();
            if (rows.stream().anyMatch(r -> r.terminalId().equals(terminal) && r.order().plan().planDate().equals(key.date())
                    && r.order().plan().planSequence() == key.sequence())) {
                throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT, "ALREADY_ATTACHED");
            }
            var spec = plan.spec();
            var summary = new Summary(key.date(), key.sequence(), plan.issuedOrder().number(), plan.issuedOrder().line(),
                    plan.item(), process, plan.quantity(), State.WAITING, new Display(null, null, spec.quality(),
                    spec.thickness().toPlainString(), spec.width().toPlainString(), spec.length().toPlainString()));
            rows.add(new ScopedPlan(terminal, new Order(summary, List.of(new Step(process, State.WAITING)))));
            attached.add(key);
        }
        inventory = new Inventory(List.copyOf(rows), inventory.stock());
        return List.copyOf(attached);
    }

    public synchronized boolean hasPlan(String terminal,synthetic.planning.PlanningDomain.PlanKey key) {
        return inventory.plans().stream().anyMatch(r->r.terminalId().equals(terminal) && r.order().plan().planDate().equals(key.date())
                && r.order().plan().planSequence()==key.sequence());
    }

    private static Map<Lot, BigDecimal> initialStock() {
        return Map.of(
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A", "BIN-01")), new BigDecimal("10.000"),
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A", "BIN-02")), new BigDecimal("4.000"),
                new Lot("DEMO-A", "LOT-A-01", new Position("WH-A2", "BIN-01")), new BigDecimal("2.000"),
                new Lot("DEMO-A", "LOT-A-02", new Position("WH-A", "BIN-02")), new BigDecimal("5.500"),
                new Lot("DEMO-B", "LOT-B-01", new Position("WH-B", "BIN-01")), new BigDecimal("8.000"));
    }

    synchronized List<Summary> list(String terminalId, State status) {
        return inventory.plans().stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(row -> row.order().plan())
                .filter(plan -> status == null || plan.status() == status)
                .toList();
    }

    public synchronized List<String> qualities(String terminal) {
        return list(terminal,null).stream().map(s->s.display()!=null?s.display().quality():s.column("mat_quacode"))
                .filter(java.util.Objects::nonNull).distinct().toList();
    }

    synchronized Optional<Detail> find(String terminalId, LocalDate date, int sequence, LotPolicy policy) {
        return inventory.plans().stream()
                .filter(row -> row.terminalId().equals(terminalId))
                .map(ScopedPlan::order)
                .filter(detail -> detail.plan().planDate().equals(date)
                        && detail.plan().planSequence() == sequence)
                .findFirst()
                .map(order -> detail(terminalId, order, inventory.stock(), policy));
    }

    synchronized Optional<Detail> apply(String terminalId, LocalDate date, int sequence,
            Action action, BigDecimal actualQuantity, long expectedRevision, String workerId,
            String lotCode, BigDecimal quantity, String warehouse, String location, LotPolicy policy) {
        var plans = inventory.plans();
        for (int index = 0; index < plans.size(); index++) {
            var current = plans.get(index);
            var order = current.order();
            var plan = order.plan();
            if (current.terminalId().equals(terminalId) && plan.planDate().equals(date)
                    && plan.planSequence() == sequence) {
                if (order.revision() != expectedRevision) {
                    throw new IllegalStateException("Work order revision changed");
                }
                boolean materialAction = action == Action.ISSUE_MATERIAL || action == Action.RETURN_MATERIAL;
                if (materialAction ? actualQuantity != null : lotCode != null || quantity != null || warehouse != null || location != null) {
                    throw new IllegalArgumentException("Unexpected fields for the action");
                }
                var stock = materialAction ? new HashMap<>(inventory.stock()) : inventory.stock();
                var updated = materialAction
                        ? moveMaterial(terminalId, workerId, order, action, lotCode, quantity,
                                warehouse, location, stock, policy)
                        : transition(order, action, actualQuantity, workerId);
                var updatedPlans = new ArrayList<>(plans);
                updatedPlans.set(index, new ScopedPlan(terminalId, updated));
                var result = detail(terminalId, updated, stock, policy);
                var workKey=key(terminalId,updated.plan().planDate(),updated.plan().planSequence());
                if(action==Action.START)starts.put(workKey,new ClockEntry(java.time.Instant.now(),"G-"+java.util.UUID.randomUUID()));
                if(action==Action.CANCEL_START){starts.remove(workKey);arrangements.remove(workKey);defects.clear(workKey);}
                inventory = new Inventory(List.copyOf(updatedPlans), Map.copyOf(stock));
                return Optional.of(result);
            }
        }
        return Optional.empty();
    }

    private Detail detail(String terminalId, Order order, Map<Lot, BigDecimal> stock, LotPolicy policy) {
        var terminalLots = stock.keySet().stream()
                .filter(lot -> lot.terminalId().equals(terminalId))
                .sorted(Comparator.comparing(Lot::code)
                        .thenComparing(lot -> lot.position().warehouse())
                        .thenComparing(lot -> lot.position().location()))
                .toList();
        var positionsByLot = new LinkedHashMap<String, List<StockPosition>>();
        for (var lot : terminalLots) {
            if (!policy.allowsIssue(lot.position().warehouse())) continue;
            positionsByLot.computeIfAbsent(lot.code(), code -> new ArrayList<>())
                    .add(new StockPosition(lot.position(), stock.get(lot)));
        }
        order.issued().keySet().stream().sorted().forEach(code ->
                positionsByLot.computeIfAbsent(code, ignored -> new ArrayList<>()));
        var materials = positionsByLot.entrySet().stream()
                .map(entry -> new Material(entry.getKey(), order.issued().getOrDefault(entry.getKey(), BigDecimal.ZERO),
                        List.copyOf(entry.getValue())))
                .toList();
        return new Detail(order.plan(), order.steps(), order.actualQuantity(), order.startedBy(),
                order.completedBy(), order.revision(), materials, new Position(policy.returnWarehouse(), policy.returnLocation()), order.events());
    }

    private Order moveMaterial(String terminalId, String workerId, Order current, Action action, String lotCode,
            BigDecimal quantity, String warehouse, String location, Map<Lot, BigDecimal> stock, LotPolicy policy) {
        if (lotCode == null || lotCode.isBlank() || quantity == null || quantity.signum() <= 0
                || quantity.stripTrailingZeros().scale() > 3) {
            throw new IllegalArgumentException("Enter a LOT and a positive quantity with up to three decimal places");
        }

        boolean issue = action == Action.ISSUE_MATERIAL;
        var state = current.plan().status();
        if (state == State.COMPLETE || (!issue && state == State.WAITING)) {
            throw new IllegalStateException("Work order state does not allow this material action");
        }
        if (issue ? warehouse == null || warehouse.isBlank() || location == null || location.isBlank()
                : warehouse != null || location != null) {
            throw new IllegalArgumentException("Only material issues require a stock location");
        }

        var position = issue ? new Position(warehouse, location) : new Position(policy.returnWarehouse(), policy.returnLocation());
        var lot = new Lot(terminalId, lotCode, position);
        var available = stock.getOrDefault(lot, BigDecimal.ZERO);
        if (issue ? !policy.allowsIssue(warehouse) || !stock.containsKey(lot)
                : stock.keySet().stream().noneMatch(key -> key.terminalId().equals(terminalId) && key.code().equals(lotCode))) {
            throw new IllegalArgumentException("LOT or stock location unavailable at this terminal");
        }
        var issued = current.issued().getOrDefault(lotCode, BigDecimal.ZERO);
        if (quantity.compareTo(issue ? available : issued) > 0) {
            throw new IllegalArgumentException(issue ? "Quantity exceeds LOT stock at this location" : "Quantity exceeds issued material");
        }

        var normalized = quantity.setScale(3);
        var delta = issue ? normalized : normalized.negate();
        var balances = new HashMap<>(current.issued());
        var remaining = issued.add(delta);
        if (remaining.signum() == 0) {
            balances.remove(lotCode);
        } else {
            balances.put(lotCode, remaining);
        }
        long revision = current.revision() + 1;
        var events = new ArrayList<>(current.events());
        long eventKey=Math.max(revision,current.events().stream().mapToLong(MaterialEvent::revision).max().orElse(0)+1);
        events.add(new MaterialEvent(action, lotCode, normalized, position, workerId, eventKey,production.spec(terminalId,lotCode,position)));
        stock.put(lot, available.subtract(delta));
        return new Order(current.plan(), current.steps(), current.actualQuantity(), current.startedBy(),
                current.completedBy(), revision, Map.copyOf(balances), List.copyOf(events));
    }

    private Order transition(Order current, Action action, BigDecimal actualQuantity, String workerId) {
        return transition(current,action,actualQuantity,workerId,false);
    }
    private Order transition(Order current, Action action, BigDecimal actualQuantity, String workerId,boolean production) {
        var plan = current.plan();
        boolean allowed = switch (action) {
            case START -> plan.status() == State.WAITING;
            case PAUSE, COMPLETE -> plan.status() == State.IN_PROGRESS;
            case RESUME -> plan.status() == State.PAUSED;
            case CANCEL_START -> plan.status() == State.IN_PROGRESS || plan.status() == State.PAUSED;
            case ISSUE_MATERIAL, RETURN_MATERIAL -> false;
        };
        if (!allowed) {
            throw new IllegalStateException("Work order is in a different state or revision");
        }

        if (!production && (action == Action.COMPLETE ? !isValidQuantity(actualQuantity, plan.plannedQuantity()) : actualQuantity != null)) {
            throw new IllegalArgumentException("Invalid actual quantity for the action");
        }

        if (!production && action == Action.START && current.issued().isEmpty()) {
            throw new IllegalStateException("Issue material before starting work");
        }

        State next = switch (action) {
            case START, RESUME -> State.IN_PROGRESS;
            case PAUSE -> State.PAUSED;
            case CANCEL_START -> State.WAITING;
            case COMPLETE -> State.COMPLETE;
            case ISSUE_MATERIAL, RETURN_MATERIAL -> throw new IllegalStateException("Not a work-state action");
        };

        var summary = new Summary(plan.planDate(), plan.planSequence(), plan.orderNumber(),
                plan.orderLine(), plan.itemName(), plan.process(), plan.plannedQuantity(), next, plan.display());
        var steps = current.steps().stream()
                .map(step -> step.name().equals(plan.process()) ? new Step(step.name(), next) : step)
                .toList();
        String startedBy = switch (action) {
            case START -> workerId;
            case CANCEL_START -> null;
            default -> current.startedBy();
        };
        return new Order(summary, steps, actualQuantity, startedBy,
                action == Action.COMPLETE ? workerId : null, current.revision() + 1, current.issued(), current.events());
    }

    private boolean isValidQuantity(BigDecimal actual, BigDecimal planned) {
        return actual != null && actual.signum() > 0 && actual.compareTo(planned) <= 0
                && actual.stripTrailingZeros().scale() <= 3;
    }
}
