package com.shinjin.pop.workprint;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class WorkPrintData {
    enum Form { Single, Multiple, Multiple1, Multiple2, Multiple3 }
    record Access(String terminal, String worker, String plant, List<Form> forms) {}
    record Order(String key, String factory, String singleDivision, Map<String,String> grid, Map<String,String> report) {
        String field(String name) { return grid.get(name); }
        int number(String name) { return Integer.parseInt(field(name)); }
    }
    record Link(String table, String factory, String plant, String orderNo, String planDate, String seq, String group, String ship) {}
    record Fixture(String note, List<Access> access, List<List<String>> centers, List<List<String>> materials,
                   List<Order> orders, List<Link> relations) {}
    record Filter(LocalDate start, LocalDate end, String center, String complete, String printed, boolean closed,
                  boolean drawing, String operator, List<String> materials, List<String> accounts) {}
    record GridRow(String key, Map<String,String> fields) {}
    record Group(String number, Map<String,String> header, List<Map<String,String>> rows) {}
    record GroupRow(String factory, String number, String row, String worker) {}
    record Removal(String number, Set<Link> links, Set<String> keys, boolean performance) {}
    final Fixture fixture;
    final Map<String,Order> orders = new LinkedHashMap<>();
    final List<Link> links;
    final List<GroupRow> groupRows = new ArrayList<>();
    final Map<String,String> erpStatus = new HashMap<>();

    WorkPrintData(Fixture fixture) {
        this.fixture = fixture;
        fixture.orders().forEach(o -> orders.put(o.key(), o));
        links = new ArrayList<>(fixture.relations());
    }
    static ResponseStatusException reject(HttpStatus status, String message) {
        return new ResponseStatusException(status, message);
    }
    List<GridRow> search(String factory, String plant, Filter f) {
        if (f.start()==null || f.end()==null || f.start().isAfter(f.end()) || f.materials()==null || f.accounts()==null
                || !List.of("전체","완료","미완료").contains(Objects.toString(f.complete(),""))
                || !List.of("전체","POP & ERP","POP","ERP","미출력").contains(Objects.toString(f.printed(),"")))
            throw reject(HttpStatus.BAD_REQUEST,"조회 조건을 확인하십시오.");
        return orders.values().stream().filter(o -> o.factory().equals(factory) && plant.equals(o.field("PLANT_CODE"))).filter(o -> {
            LocalDate day=LocalDate.parse(o.field("ORDER_DATE"));
            boolean done=o.number("SHIPPING_QTY")>=o.number("ORDER_QTY");
            boolean pop=o.number("PRINT_CNT")>0, erp=o.number("ERP_PRINT_CNT")>0;
            String printed=pop ? (erp ? "POP & ERP":"POP") : (erp ? "ERP":"미출력");
            return "1".equals(o.field("ORDER_GBN")) && ("100".equals(o.field("ITEM_KIND1")) || "700".equals(o.field("ITEM_KIND1")) && "A70".equals(o.field("ITEM_KIND2")))
                    && !day.isBefore(f.start()) && !day.isAfter(f.end())
                    && ("000".equals(f.center()) || o.field("WORKCENTER_CODE").equals(f.center()))
                    && ("전체".equals(f.complete()) || done=="완료".equals(f.complete()))
                    && ("전체".equals(f.printed()) || printed.equals(f.printed()))
                    && (f.closed()?"1":"0").equals(o.field("CLOSING_FLAG"))
                    && (!f.drawing() || Set.of("002","003").contains(o.field("FG_USE2")))
                    && ("".equals(f.operator()) || o.field("OPMAN_CODE").equals(f.operator()))
                    && f.materials().contains(o.field("MATERIAL_CODE"))
                    && (o.field("NM_SL").isEmpty() || f.accounts().contains(o.field("NM_SL")));
        }).sorted(Comparator.comparing((Order o)->o.field("ORDER_NO"),Comparator.reverseOrder())
                .thenComparingInt(o->o.number("ORDER_SEQNO"))).map(o -> new GridRow(o.key(),Map.copyOf(o.grid()))).toList();
    }
    List<Order> selected(String factory, String plant, List<String> keys) {
        if (keys==null || keys.isEmpty() || keys.size()>orders.size() || new HashSet<>(keys).size()!=keys.size())
            throw reject(HttpStatus.BAD_REQUEST,"출력하실 데이터를 선택하십시오.");
        return keys.stream().map(key -> {
            Order o=orders.get(key);
            if (o==null || !factory.equals(o.factory()) || !plant.equals(o.field("PLANT_CODE"))) throw reject(HttpStatus.NOT_FOUND,"수주행을 찾을 수 없습니다.");
            if (!"0".equals(o.field("CLOSING_FLAG")) || !"0".equals(o.report().get("CLOSING_FLAG")))
                throw reject(HttpStatus.CONFLICT,"종결 된 수주건은 출력 할 수 없습니다.");
            return o;
        }).toList();
    }
    Map<List<String>,List<Order>> grouped(Form form, List<Order> rows) {
        return rows.stream().collect(Collectors.groupingBy(o -> switch(form) {
            case Single -> List.of("Single");
            case Multiple2 -> List.of(o.field("CUSTOMER_NAME"));
            case Multiple3 -> List.of(o.field("CUSTOMER_NAME"),o.field("MAT_QUALITY_NAME"));
            default -> List.of(o.field("CUSTOMER_NAME"),o.field("MAT_QUALITY_NAME"),o.field("ORDER_NO"),o.field("CUST_ITEM_CODE_QUALITY"));
        },LinkedHashMap::new,Collectors.toList()));
    }
    Removal scan(String factory,String plant,String barcode) {
        if (barcode==null || barcode.length()!=12 && barcode.length()!=16)
            throw reject(HttpStatus.BAD_REQUEST,"수주번호가 없습니다.");
        String no=barcode.substring(0,12);
        var local=links.stream().filter(l->l.factory().equals(factory) && plant.equals(l.plant())).toList();
        var plans=local.stream().filter(l -> l.table().equals("TPR301") && l.orderNo().equals(no)).toList();
        if (plans.isEmpty()) throw reject(HttpStatus.NOT_FOUND,"수주번호가 없습니다.");
        String day=plans.get(0).planDate();
        Set<String> seq=plans.stream().map(Link::seq).collect(Collectors.toSet());
        var results=local.stream().filter(l->l.table().equals("TPR601") && day.equals(l.planDate()) && seq.contains(l.seq())).toList();
        var groups=results.stream().map(Link::group).collect(Collectors.toSet());
        var shipments=local.stream().filter(l->l.table().equals("TSA407") && no.equals(l.orderNo())).map(Link::ship).collect(Collectors.toSet());
        Set<Link> affected=local.stream().filter(l-> switch(l.table()) {
            case "TPR301","TPR301R" -> day.equals(l.planDate()) && seq.contains(l.seq());
            case "TSA307","TSA308" -> no.equals(l.orderNo());
            case "TPR601","TPR601LOT","TPR603" -> !results.isEmpty() && day.equals(l.planDate()) && seq.contains(l.seq());
            case "TPR601M","TPR601T","TPR601MT" -> groups.contains(l.group());
            case "TSA407L" -> !results.isEmpty() && shipments.contains(l.ship());
            case "TSA407" -> !results.isEmpty() && no.equals(l.orderNo());
            default -> false;
        }).collect(Collectors.toSet());
        var keys=orders.values().stream().filter(o->factory.equals(o.factory()) && plant.equals(o.field("PLANT_CODE")) && no.equals(o.field("ORDER_NO")))
                .map(Order::key).collect(Collectors.toSet());
        return new Removal(no,affected,keys,!results.isEmpty());
    }
}